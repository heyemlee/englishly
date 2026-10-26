"""Turn caption snippets into practice sentences with estimated start/end times.

Captions arrive as fragments ("snippets") that don't line up with sentences, so we:
1. time every word: YouTube's automatic captions and Whisper give real word times; otherwise each snippet's time
   window is spread over its words (by character length), and moved onto real times when we have them (retime),
2. split the word stream into sentences (by punctuation, or a crude fallback by length),
3. keep sentences between MIN_WORDS and MAX_WORDS so they're comfortable to loop and shadow.
"""

import difflib
import html
import re
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field

from .youtube import Snippet, Transcript

MIN_WORDS = 3
MAX_WORDS = 30
FALLBACK_WORDS = 12

_SOUND_ONLY = re.compile(r"^\s*\([A-Za-z ]+\)\s*$")  # a whole snippet like "(Laughter)"
_SOUND_TAG = re.compile(r"\((?:laughter|applause|music|laughs|cheers|cheering|audience laughs)\)", re.I)
_NOISE = re.compile(r"\[[^\]]*\]|♪|>>")
_TERMINAL = re.compile(r"[.?!…][\"”’')\]]*$")
_CLAUSE = re.compile(r"[,;:][\"”’')\]]*$|^--$|—$")
_ABBREVIATIONS = {"mr.", "mrs.", "ms.", "dr.", "st.", "vs.", "etc.", "e.g.", "i.e.", "u.s.", "jr.", "sr."}


@dataclass
class Word:
    text: str
    start: float
    end: float
    snippet: int


@dataclass
class Sentence:
    start: float
    end: float
    text: str


@dataclass
class Segment:
    """Display tokens of one sentence plus, for each token, the index of the source word it came from."""

    tokens: list[str] = field(default_factory=list)
    idx: list[int] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.tokens)

    def merged(self, other: "Segment") -> "Segment":
        return Segment(self.tokens + other.tokens, self.idx + other.idx)


def clean(text: str) -> str:
    text = html.unescape(text).replace("\n", " ")
    if _SOUND_ONLY.match(text):
        return ""
    text = _SOUND_TAG.sub(" ", text)
    text = _NOISE.sub(" ", text)
    return " ".join(text.split())


def spread(tokens: list[str], start: float, end: float, snippet: int) -> list[Word]:
    """Estimate word times by sharing [start, end] out by character length."""
    weights = [len(t) + 1 for t in tokens]
    total = sum(weights)
    words, t = [], start
    for tok, w in zip(tokens, weights):
        dur = (end - start) * w / total
        words.append(Word(tok, t, t + dur, snippet))
        t += dur
    return words


def build_words(snippets: list[Snippet]) -> list[Word]:
    words: list[Word] = []
    for i, snip in enumerate(snippets):
        tokens = clean(snip.text).split()
        if not tokens:
            continue
        start = snip.start
        end = snip.start + max(snip.duration, 0.2)
        # Auto-generated snippets overlap; the next snippet's start is a better end estimate.
        if i + 1 < len(snippets) and start < snippets[i + 1].start < end:
            end = snippets[i + 1].start
        words += spread(tokens, start, end, i)
    return words


def timed_words(snippets: list[Snippet]) -> list[Word]:
    """Words that come with their own times (YouTube's automatic captions); snippet = the caption line."""
    return [Word(tok, s.start, s.start + s.duration, s.line) for s in snippets for tok in clean(s.text).split()]


def transcript_words(transcript: Transcript) -> list[Word]:
    """Caption words with the best times we have."""
    if not transcript.words:
        return build_words(transcript.snippets)
    timed = timed_words(transcript.words)
    if transcript.is_generated:
        return timed  # the automatic captions are the timed words themselves
    return retime(build_words(transcript.snippets), timed)  # human-made text, speech-recognition times


def ends_sentence(token: str) -> bool:
    return token.lower() not in _ABBREVIATIONS and bool(_TERMINAL.search(token))


def has_punctuation(words: list[Word]) -> bool:
    terminals = sum(1 for w in words if ends_sentence(w.text))
    return terminals >= max(1, len(words) / 40)


def split_by_punctuation(words: list[Word]) -> list[Segment]:
    segs, cur = [], Segment()
    for i, w in enumerate(words):
        cur.tokens.append(w.text)
        cur.idx.append(i)
        if ends_sentence(w.text):
            segs.append(cur)
            cur = Segment()
    if cur.tokens:
        segs.append(cur)
    return segs


def split_fallback(words: list[Word]) -> list[Segment]:
    """No punctuation: cut every ~12 words, preferably where a caption snippet starts."""
    segs, cur = [], Segment()
    for i, w in enumerate(words):
        at_snippet_start = i > 0 and w.snippet != words[i - 1].snippet
        if cur.tokens and ((len(cur) >= FALLBACK_WORDS and at_snippet_start) or len(cur) >= FALLBACK_WORDS + 6):
            segs.append(cur)
            cur = Segment()
        cur.tokens.append(w.text)
        cur.idx.append(i)
    if cur.tokens:
        segs.append(cur)
    return segs


def _norm(token: str) -> str:
    return re.sub(r"[^a-z0-9']", "", token.lower().replace("’", "'"))


RETIME_WINDOW = 200  # caption words matched at a time
RETIME_SLACK = 15.0  # seconds that caption times may be off from the real ones


def retime(words: list[Word], timed: list[Word]) -> list[Word]:
    """Move caption words onto the times of the same words in `timed` (speech recognition with real word times).

    Both lists are in time order, so each window of caption words is matched only against the nearby part of
    `timed`, which keeps hour-long episodes fast. Words without a match are spread over the gap between their
    matched neighbours; words before the first or after the last match shift along with it.
    """
    if not words or not timed:
        return words
    starts = [w.start for w in timed]
    targets = [_norm(w.text) or f"\0{j}" for j, w in enumerate(timed)]  # unique, so punctuation never matches
    match: dict[int, int] = {}
    for lo in range(0, len(words), RETIME_WINDOW):
        chunk = words[lo : lo + RETIME_WINDOW]
        a = bisect_left(starts, chunk[0].start - RETIME_SLACK)
        b = bisect_right(starts, chunk[-1].end + RETIME_SLACK)
        src = [_norm(w.text) or f"\1{i}" for i, w in enumerate(chunk)]
        for i, j, size in difflib.SequenceMatcher(None, src, targets[a:b], autojunk=False).get_matching_blocks():
            for d in range(size):
                match.setdefault(lo + i + d, a + j + d)
    # A repeated phrase can match the wrong occurrence: keep only matches that move forward in time.
    anchors, last = [], -1
    for i in sorted(match):
        if match[i] > last:
            anchors.append(i)
            last = match[i]
    if not anchors:
        return words

    out = list(words)
    for i in anchors:
        t = timed[match[i]]
        out[i] = Word(words[i].text, t.start, t.end, words[i].snippet)
    first, final = anchors[0], anchors[-1]
    for i, shift in [*((i, out[first].start - words[first].start) for i in range(first)),
                     *((i, out[final].start - words[final].start) for i in range(final + 1, len(words)))]:
        w = words[i]
        out[i] = Word(w.text, max(0.0, w.start + shift), max(0.0, w.end + shift), w.snippet)
    for p, n in zip(anchors, anchors[1:]):
        if n - p == 1:
            continue
        # Map the caption's own timeline between the two matches onto the real one, so pauses (laughter, music)
        # where the recognizer heard nothing stay where the captions put them.
        o0, o1 = words[p].end, words[n].start
        t0 = out[p].end
        t1 = max(out[n].start, t0)
        if o1 - o0 < 0.05:
            gap = spread([w.text for w in words[p + 1 : n]], t0, t1, 0)
            for k, w in enumerate(gap, start=p + 1):
                out[k] = Word(w.text, w.start, w.end, words[k].snippet)
            continue
        scale = (t1 - t0) / (o1 - o0)
        for k in range(p + 1, n):
            w = words[k]
            to_real = [t0 + (min(max(x, o0), o1) - o0) * scale for x in (w.start, w.end)]
            out[k] = Word(w.text, to_real[0], to_real[1], w.snippet)
    return out


def retime_sentences(sentences: list[tuple[float, float, str]], timed: list[Word]) -> list[tuple[float, float]]:
    """New (start, end) for existing sentences, keeping their text, from words with real times (Whisper)."""
    words: list[Word] = []
    for k, (start, end, text) in enumerate(sentences):
        tokens = text.split()
        if tokens:
            words += spread(tokens, start, max(end, start + 0.1), k)
    moved = retime(words, timed)
    spans: dict[int, list[float]] = {}
    for w in moved:
        span = spans.setdefault(w.snippet, [w.start, w.end])
        span[1] = max(span[1], w.end)
    return [
        (round(spans[k][0], 2), round(max(spans[k][1], spans[k][0] + 0.3), 2)) if k in spans else (start, end)
        for k, (start, end, _) in enumerate(sentences)
    ]


def _split_point(seg: Segment) -> int | None:
    n = len(seg)
    lo, hi = MIN_WORDS + 3, n - MIN_WORDS - 3
    candidates = [p for p in range(max(lo, 1), max(hi, 1) + 1) if seg.idx[p] > seg.idx[0]]
    if not candidates:
        return None
    middle = n / 2
    clause = [p for p in candidates if _CLAUSE.search(seg.tokens[p - 1]) or seg.tokens[p] == "--"]
    pool = clause or candidates
    return min(pool, key=lambda p: abs(p - middle))


def normalize(segs: list[Segment]) -> list[Segment]:
    # Merge fragments that are too short to practise on their own ("Yeah.", "Right?").
    merged: list[Segment] = []
    carry: Segment | None = None
    for seg in segs:
        if carry is not None:
            seg, carry = carry.merged(seg), None
        if len(seg) < MIN_WORDS:
            if merged and len(merged[-1]) + len(seg) <= MAX_WORDS:
                merged[-1] = merged[-1].merged(seg)
            else:
                carry = seg
            continue
        merged.append(seg)
    if carry is not None:
        if merged:
            merged[-1] = merged[-1].merged(carry)
        else:
            merged.append(carry)

    # Split run-on sentences, preferably at a comma near the middle.
    out: list[Segment] = []
    stack = list(reversed(merged))
    while stack:
        seg = stack.pop()
        p = _split_point(seg) if len(seg) > MAX_WORDS else None
        if p is None:
            out.append(seg)
        else:
            stack.append(Segment(seg.tokens[p:], seg.idx[p:]))
            stack.append(Segment(seg.tokens[:p], seg.idx[:p]))

    # Every sentence must start at a later source word than the one before it.
    result: list[Segment] = []
    for seg in out:
        if result and seg.idx[0] <= result[-1].idx[0]:
            result[-1] = result[-1].merged(seg)
        else:
            result.append(seg)
    return result


def to_sentences(words: list[Word], segs: list[Segment]) -> list[Sentence]:
    sentences = []
    for n, seg in enumerate(segs):
        first = 0 if n == 0 else seg.idx[0]
        last = len(words) - 1 if n == len(segs) - 1 else segs[n + 1].idx[0] - 1
        text = " ".join(seg.tokens)
        sentences.append(Sentence(round(words[first].start, 2), round(words[last].end, 2), text))
    return sentences


def segment_by_rules(words: list[Word]) -> tuple[list[Sentence], str]:
    if has_punctuation(words):
        return to_sentences(words, normalize(split_by_punctuation(words))), "punctuation"
    return to_sentences(words, normalize(split_fallback(words))), "fallback"


def assign_clips(sentences: list[Sentence], clip_seconds: float) -> list[int]:
    if not sentences:
        return []
    clips, clip, clip_start = [], 0, sentences[0].start
    for s in sentences:
        if s.start - clip_start >= clip_seconds:
            clip += 1
            clip_start = s.start
        clips.append(clip)
    # Fold a very short final clip into the previous one.
    if clip > 0:
        last_start = next(s.start for s, c in zip(sentences, clips) if c == clip)
        if sentences[-1].end - last_start < clip_seconds / 4:
            clips = [c if c < clip else clip - 1 for c in clips]
    return clips

import pytest

from app.segment import (
    MAX_WORDS,
    Segment,
    assign_clips,
    build_words,
    clean,
    has_punctuation,
    normalize,
    segment_by_rules,
    to_sentences,
)
from app.youtube import Snippet, TranscriptError, parse_video_id


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=arj7oStGLkU",
        "https://youtube.com/watch?v=arj7oStGLkU&t=42s",
        "https://youtu.be/arj7oStGLkU?si=abc",
        "https://www.youtube.com/shorts/arj7oStGLkU",
        "https://m.youtube.com/watch?v=arj7oStGLkU",
        "youtube.com/embed/arj7oStGLkU",
        "arj7oStGLkU",
    ],
)
def test_parse_video_id(url):
    assert parse_video_id(url) == "arj7oStGLkU"


def test_parse_video_id_rejects_other_sites():
    with pytest.raises(TranscriptError):
        parse_video_id("https://vimeo.com/123456")


def test_clean_drops_sound_tags():
    assert clean("(Laughter)") == ""
    assert clean("[Music] so &#39;cause\nI said") == "so 'cause I said"
    assert clean("♪ never gonna ♪") == "never gonna"


def test_build_words_uses_next_snippet_start_for_overlapping_auto_captions():
    words = build_words([Snippet("so in", 10.0, 4.0), Snippet("college I was", 11.0, 4.0)])
    assert [w.text for w in words] == ["so", "in", "college", "I", "was"]
    assert words[0].start == 10.0
    assert words[1].end == pytest.approx(11.0)  # cut at the next snippet, not 14.0
    assert words[-1].end == pytest.approx(15.0)
    assert all(a.end <= b.start + 1e-9 for a, b in zip(words, words[1:]))


def test_punctuated_captions_split_on_sentence_ends():
    snippets = [
        Snippet("So in college, I was a government major.", 0.0, 3.0),
        Snippet("Yeah.", 3.0, 0.5),
        Snippet("I had to write a lot of papers, Mr. Smith said.", 3.5, 3.0),
    ]
    words = build_words(snippets)
    assert has_punctuation(words)
    sentences, method = segment_by_rules(words)
    assert method == "punctuation"
    # "Yeah." is too short to practise alone, so it joins the previous sentence; "Mr." doesn't end a sentence.
    assert [s.text for s in sentences] == [
        "So in college, I was a government major. Yeah.",
        "I had to write a lot of papers, Mr. Smith said.",
    ]
    assert sentences[0].start == 0.0 and sentences[1].end == 6.5


def test_long_sentence_is_split_at_a_comma():
    first = " ".join(["one"] * 20)
    second = " ".join(["two"] * 20)
    words = build_words([Snippet(f"{first}, {second}.", 0.0, 20.0)])
    sentences, _ = segment_by_rules(words)
    assert len(sentences) == 2
    assert sentences[0].text.endswith("one,")
    assert all(len(s.text.split()) <= MAX_WORDS for s in sentences)


def test_unpunctuated_captions_fall_back_to_length():
    snippets = [Snippet("this is some caption text without any marks", i * 2.0, 2.0) for i in range(5)]
    words = build_words(snippets)
    assert not has_punctuation(words)
    sentences, method = segment_by_rules(words)
    assert method == "fallback"
    assert sum(len(s.text.split()) for s in sentences) == len(words)


def test_assign_clips_folds_a_short_tail():
    words = build_words([Snippet(f"Sentence number {i} is here.", i * 10.0, 10.0) for i in range(40)])
    sentences, _ = segment_by_rules(words)
    clips = assign_clips(sentences, 180)
    assert clips[0] == 0 and clips == sorted(clips)
    assert max(clips) == 1  # 400s -> [0,180) + [180,400); a 40s tail would have been folded in

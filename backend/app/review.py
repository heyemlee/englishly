"""Spaced-repetition review. Scheduling is FSRS (py-fsrs).

Each expression the learner saves from a sentence becomes up to three sibling cards with separate schedules:
  produce: see its meaning, say the expression (the sentence it came from, blanked, is the hint)
  listen:  hear the original sentence, catch the expression and its meaning
  cloze:   see the original sentence with the expression blanked out, fill it in
Siblings share a `note`; once one of them has been reviewed today, the others wait for another day.
"""

import hashlib
import json
import math
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from fsrs import Card, Rating, Scheduler, State
from pydantic import BaseModel, Field

from .config import NEW_CARDS_PER_DAY
from .db import connect

router = APIRouter(prefix="/api")

scheduler = Scheduler(desired_retention=0.9)
_preview = Scheduler(desired_retention=0.9, enable_fuzzing=False)  # interval hints on the rating buttons
LEARN_AHEAD = timedelta(minutes=20)  # when nothing is due, pull in learning cards due this soon

KINDS = ("produce", "listen", "cloze")

# Words in a pattern like "end up + doing" that stand for "anything goes here". The weak ones are only
# placeholders right after a "+" ("Do you happen to + do": the first "Do" is part of the expression).
PLACEHOLDERS = {"sb", "sth", "someone", "something", "somebody", "adj", "adjective", "noun", "verb", "clause", "sentence"}
WEAK_PLACEHOLDERS = {"doing", "do", "n", "v", "place", "time", "person", "x", "y"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def stamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def start_of_today() -> str:
    """Local midnight (the learner's day), as a UTC stamp."""
    local = datetime.now().astimezone()
    return stamp(local.replace(hour=0, minute=0, second=0, microsecond=0))


def _norm(word: str) -> str:
    return re.sub(r"[^a-z0-9']", "", word.lower().replace("’", "'"))


def cloze_blanks(answer_en: str, hint: str) -> list[int]:
    """Indices of the words in `answer_en` that spell out the expression `hint` (allowing "end" ~ "ended")."""
    keys: set[str] = set()
    for i, part in enumerate(hint.split("+")):
        words = [w for w in (_norm(t) for t in re.split(r"[\s/…]+|\.\.\.", part)) if w]
        if i > 0 and words and words[0] in WEAK_PLACEHOLDERS:
            words = words[1:]  # the slot right after "+"
        keys |= {w for w in words if w not in PLACEHOLDERS}
    if not keys:
        return []

    def hit(word: str) -> bool:
        n = _norm(word)
        return bool(n) and any(
            n == k or (len(k) >= 3 and n.startswith(k)) or (len(n) >= 3 and k.startswith(n) and len(k) - len(n) <= 2)
            for k in keys
        )

    best: list[int] = []
    run: list[int] = []
    for i, word in enumerate(answer_en.split()):
        run = run + [i] if hit(word) else []
        if len(run) > len(best):
            best = run
    return best if len(best) >= math.ceil(len(keys) / 2) else []


def note_for(chunk_id: int | None, prompt_zh: str, answer_en: str) -> str:
    if chunk_id is not None:
        return f"chunk:{chunk_id}"
    return "text:" + hashlib.sha1(f"{prompt_zh}|{answer_en}".encode()).hexdigest()[:16]


def _insert(conn: sqlite3.Connection, kind: str, note: str, source: str, prompt_zh: str, answer_en: str, hint: str,
            chunk_id: int | None, sentence_id: int | None) -> int | None:
    card = Card()
    conn.execute(
        """INSERT OR IGNORE INTO cards (kind, note, source, chunk_id, sentence_id, prompt_zh, answer_en, hint,
                                        fsrs, due, state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (kind, note, source, chunk_id, sentence_id, prompt_zh, answer_en, hint,
         json.dumps(card.to_dict()), stamp(card.due), int(card.state)),
    )
    row = conn.execute(
        """SELECT id FROM cards WHERE kind = ?
              AND ((chunk_id IS NOT NULL AND chunk_id = ?) OR (prompt_zh = ? AND answer_en = ?))""",
        (kind, chunk_id, prompt_zh, answer_en),
    ).fetchone()
    return row["id"] if row else None


def blanked(text: str, expression: str) -> str:
    """`text` with the words of `expression` replaced by blanks ("I ____ __ working late again.")."""
    return " ".join(
        f"{t['before']}{'_' * max(2, len(t['text']))}{t['after']}" if t["blank"] else t["text"]
        for t in cloze_tokens(text, expression)
    )


def add_card(
    conn: sqlite3.Connection,
    *,
    source: str,
    prompt_zh: str,
    answer_en: str,
    hint: str = "",
    chunk_id: int | None = None,
    sentence: sqlite3.Row | None = None,
    context_en: str = "",
) -> int | None:
    """Create the sibling cards for one expression; returns the produce card's id.

    With `sentence` (id, text: where the expression was heard), the listen card plays that sentence and the cloze card
    blanks the expression in it. Without, the listen card reads `answer_en` aloud and the cloze card blanks `hint` in
    `answer_en`, when it can find it there.
    """
    prompt_zh, answer_en, hint = prompt_zh.strip(), answer_en.strip(), hint.strip()
    if not prompt_zh or not answer_en:
        return None
    common = {"note": note_for(chunk_id, prompt_zh, answer_en), "source": source, "prompt_zh": prompt_zh,
              "chunk_id": chunk_id}
    if sentence is None and not context_en:
        produce_id = _insert(conn, "produce", answer_en=answer_en, hint=hint, sentence_id=None, **common)
        _insert(conn, "listen", answer_en=answer_en, hint=hint, sentence_id=None, **common)
        if cloze_blanks(answer_en, hint):
            _insert(conn, "cloze", answer_en=answer_en, hint=hint, sentence_id=None, **common)
        return produce_id
    context = sentence["text"] if sentence is not None else context_en
    found = bool(cloze_blanks(context, answer_en))
    produce_id = _insert(conn, "produce", answer_en=answer_en, hint=blanked(context, answer_en) if found else context,
                         sentence_id=None, **common)
    _insert(conn, "listen", answer_en=context, hint=answer_en,
            sentence_id=sentence["id"] if sentence is not None else None, **common)
    if found:
        _insert(conn, "cloze", answer_en=context, hint=answer_en, sentence_id=None, **common)
    return produce_id


def add_chunk_card(conn: sqlite3.Connection, chunk: sqlite3.Row) -> int | None:
    sentence = None
    if chunk["sentence_id"] is not None:
        sentence = conn.execute("SELECT id, text FROM sentences WHERE id = ?", (chunk["sentence_id"],)).fetchone()
    return add_card(conn, source="manual" if chunk["entry_source"] == "manual" else "chunk", chunk_id=chunk["id"],
                    prompt_zh=chunk["meaning_zh"], answer_en=chunk["pattern"], sentence=sentence,
                    context_en=chunk["context_en"])


def backfill_chunk_cards() -> None:
    """Chunks saved before review existed get their cards. Runs once, when upgrading a v0.1 database."""
    with connect() as conn:
        for chunk in conn.execute(
            "SELECT * FROM saved_chunks WHERE id NOT IN (SELECT chunk_id FROM cards WHERE chunk_id IS NOT NULL)"
        ).fetchall():
            add_chunk_card(conn, chunk)


def backfill_card_kinds() -> None:
    """Cards from before v5 were all "produce": give them their listen and cloze siblings. Runs once."""
    with connect() as conn:
        for row in conn.execute("SELECT * FROM cards WHERE kind = 'produce'").fetchall():
            if row["chunk_id"] is not None:
                chunk = conn.execute("SELECT * FROM saved_chunks WHERE id = ?", (row["chunk_id"],)).fetchone()
                if chunk:
                    add_chunk_card(conn, chunk)
                continue
            conn.execute(
                "UPDATE cards SET note = ? WHERE id = ?", (note_for(None, row["prompt_zh"], row["answer_en"]), row["id"])
            )
            add_card(conn, source=row["source"], prompt_zh=row["prompt_zh"], answer_en=row["answer_en"],
                     hint=row["hint"])


def enabled_kinds(conn: sqlite3.Connection) -> list[str]:
    row = conn.execute("SELECT value FROM settings WHERE key = 'review.kinds'").fetchone()
    kinds = [k for k in (row["value"].split(",") if row else KINDS) if k in KINDS]
    return kinds or list(KINDS)


def _available(conn: sqlite3.Connection, now: datetime, kinds: list[str]) -> tuple[list[sqlite3.Row], list[sqlite3.Row]]:
    """Due cards and new cards that can be shown now, oldest first, minus siblings of cards reviewed today."""
    reviewed: dict[str, set[int]] = {}
    for r in conn.execute(
        "SELECT c.note, c.id FROM reviews r JOIN cards c ON c.id = r.card_id WHERE r.reviewed_at >= ?",
        (start_of_today(),),
    ):
        reviewed.setdefault(r["note"], set()).add(r["id"])

    def buried(row: sqlite3.Row) -> bool:
        return bool(reviewed.get(row["note"], set()) - {row["id"]})

    marks = ",".join("?" * len(kinds))
    due = [
        r
        for r in conn.execute(
            f"SELECT * FROM cards WHERE kind IN ({marks}) AND reps > 0 AND due <= ? ORDER BY due", (*kinds, stamp(now))
        )
        if r["state"] != int(State.Review) or not buried(r)  # cards in (re)learning steps always come back
    ]
    new = [
        r
        for r in conn.execute(f"SELECT * FROM cards WHERE kind IN ({marks}) AND reps = 0 ORDER BY id", kinds)
        if not buried(r) and r["note"] not in reviewed
    ]
    return due, new


def summary(conn: sqlite3.Connection, now: datetime, due: list, new: list, kinds: list[str]) -> dict:
    today = start_of_today()
    new_today = conn.execute(
        "SELECT COUNT(*) FROM reviews WHERE was_new = 1 AND reviewed_at >= ?", (today,)
    ).fetchone()[0]
    marks = ",".join("?" * len(kinds))
    return {
        "due": len(due),
        "new_available": min(len(new), max(0, NEW_CARDS_PER_DAY - new_today)),
        "new_total": conn.execute(f"SELECT COUNT(*) FROM cards WHERE reps = 0 AND kind IN ({marks})", kinds).fetchone()[0],
        "reviewed_today": conn.execute("SELECT COUNT(*) FROM reviews WHERE reviewed_at >= ?", (today,)).fetchone()[0],
        "total": conn.execute(f"SELECT COUNT(*) FROM cards WHERE kind IN ({marks})", kinds).fetchone()[0],
        "next_due": conn.execute(
            f"SELECT MIN(due) FROM cards WHERE reps > 0 AND due > ? AND kind IN ({marks})", (stamp(now), *kinds)
        ).fetchone()[0],
        "kinds": kinds,
    }


def next_card(conn: sqlite3.Connection, now: datetime, due: list, new: list, stats: dict, kinds: list[str]):
    if due:
        return due[0]
    if new and stats["new_available"] > 0:
        return new[0]
    marks = ",".join("?" * len(kinds))
    return conn.execute(
        f"SELECT * FROM cards WHERE kind IN ({marks}) AND reps > 0 AND state != ? AND due <= ? ORDER BY due LIMIT 1",
        (*kinds, int(State.Review), stamp(now + LEARN_AHEAD)),
    ).fetchone()


def human_interval(delta: timedelta) -> str:
    minutes = delta.total_seconds() / 60
    if minutes < 60:
        return f"{max(1, round(minutes))}分钟"
    if minutes < 60 * 24:
        return f"{round(minutes / 60)}小时"
    days = minutes / (60 * 24)
    if days < 30:
        return f"{round(days)}天"
    if days < 365:
        return f"{days / 30:.1f}个月".replace(".0个", "个")
    return f"{days / 365:.1f}年".replace(".0年", "年")


def cloze_tokens(answer_en: str, hint: str) -> list[dict]:
    """The sentence as tokens; blanked ones keep their surrounding punctuation outside the blank."""
    blanks = set(cloze_blanks(answer_en, hint))
    tokens = []
    for i, word in enumerate(answer_en.split()):
        if i in blanks:
            m = re.match(r"^(\W*)(.*?)(\W*)$", word)
            tokens.append({"text": m.group(2), "blank": True, "before": m.group(1), "after": m.group(3)})
        else:
            tokens.append({"text": word, "blank": False, "before": "", "after": ""})
    return tokens


def card_payload(conn: sqlite3.Connection, row: sqlite3.Row, now: datetime) -> dict:
    intervals = {}
    for rating in Rating:
        after, _ = _preview.review_card(Card.from_dict(json.loads(row["fsrs"])), rating, now)
        intervals[int(rating)] = human_interval(after.due - now)

    origin = None
    if row["chunk_id"] is not None:
        o = conn.execute(
            """SELECT c.pattern, s.text AS sentence, s.idx AS sentence_idx, e.id AS episode_id, e.title
                 FROM saved_chunks c
                 LEFT JOIN sentences s ON s.id = c.sentence_id
                 LEFT JOIN episodes e ON e.id = s.episode_id
                WHERE c.id = ?""",
            (row["chunk_id"],),
        ).fetchone()
        origin = dict(o) if o else None

    listen = None
    if row["kind"] == "listen" and row["sentence_id"] is not None:
        s = conn.execute(
            """SELECT s.start_s, s.end_s, s.idx, e.id AS episode_id, e.video_id, e.source,
                      (e.source = 'podcast' OR e.audio_status = 'ready' OR e.video_status = 'ready') AS has_audio
                 FROM sentences s JOIN episodes e ON e.id = s.episode_id
                WHERE s.id = ? AND e.status = 'ready'""",
            (row["sentence_id"],),
        ).fetchone()
        if s:
            listen = {"episode_id": s["episode_id"], "video_id": s["video_id"], "source": s["source"],
                      "audio": bool(s["has_audio"]),  # a local file to play (podcast, downloaded audio or the MP4): /api/media
                      "start": s["start_s"], "end": s["end_s"], "sentence_idx": s["idx"]}

    return {
        "id": row["id"],
        "kind": row["kind"],
        "source": row["source"],
        "prompt_zh": row["prompt_zh"],
        "answer_en": row["answer_en"],
        "hint": row["hint"],
        "is_new": row["reps"] == 0,
        "intervals": intervals,
        "origin": origin,
        "listen": listen,  # listen cards with an original recording; otherwise the app reads the answer aloud
        "cloze": cloze_tokens(row["answer_en"], row["hint"]) if row["kind"] == "cloze" else None,
    }


def queue_state(conn: sqlite3.Connection) -> dict:
    now = utcnow()
    kinds = enabled_kinds(conn)
    due, new = _available(conn, now, kinds)
    stats = summary(conn, now, due, new, kinds)
    row = next_card(conn, now, due, new, stats, kinds)
    return {"summary": stats, "card": card_payload(conn, row, now) if row else None}


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=4)
    said: str = ""
    score: float | None = Field(default=None, ge=0, le=1)


class KindsIn(BaseModel):
    kinds: list[Literal["produce", "listen", "cloze"]] = Field(min_length=1)


@router.put("/review/kinds")
def set_kinds(body: KindsIn):
    with connect() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('review.kinds', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (",".join(k for k in KINDS if k in body.kinds),),
        )
        return queue_state(conn)


@router.get("/review")
def get_queue():
    with connect() as conn:
        return queue_state(conn)


@router.post("/review/{card_id}")
def review(card_id: int, body: ReviewIn):
    now = utcnow()
    with connect() as conn:
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        if not row:
            raise HTTPException(404, "找不到这张卡片。")
        card, _ = scheduler.review_card(Card.from_dict(json.loads(row["fsrs"])), Rating(body.rating), now)
        conn.execute(
            "UPDATE cards SET fsrs = ?, due = ?, state = ?, reps = reps + 1 WHERE id = ?",
            (json.dumps(card.to_dict()), stamp(card.due), int(card.state), card_id),
        )
        conn.execute(
            "INSERT INTO reviews (card_id, rating, said, score, was_new, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)",
            (card_id, body.rating, body.said, body.score, 1 if row["reps"] == 0 else 0, stamp(now)),
        )
        return queue_state(conn)


@router.get("/cards")
def list_cards():
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, kind, source, prompt_zh, answer_en, hint, due, state, reps, created_at FROM cards ORDER BY id DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@router.delete("/cards/{card_id}")
def delete_card(card_id: int):
    with connect() as conn:
        conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))
    return {"ok": True}

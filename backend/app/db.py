import json
import re
import sqlite3
from contextlib import contextmanager
from typing import Iterator

from .config import DB_PATH

# 1: v0.1; 2: cards, phrases, conversations, retells; 3: settings; 4: podcasts; 5: card kinds;
# 6: YouTube channels and audio; 7: AI features removed (phrases, conversations, AI notes and feedback);
# 8: Chinese translations; 9: study annotations, clip lessons and listening progress; 10: manual notebook entries;
# 11: locally playable video; 12: starred episodes; 13: on-site streaming study; 14: official Chinese subtitle tracks;
# 15: notebook entries waiting for a meaning before they join review
SCHEMA_VERSION = 15

# One expression gives up to three cards ("siblings", same `note`): produce (see the meaning, say the English),
# listen (hear the original sentence, get the meaning) and cloze (fill in the expression).
CARDS_COLUMNS = """
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'produce',  -- produce | listen | cloze
    note        TEXT NOT NULL DEFAULT '',         -- siblings share it; only one of them is shown per day
    source      TEXT NOT NULL,                    -- chunk (older versions also made phrase | talk | retell | manual)
    chunk_id    INTEGER REFERENCES saved_chunks(id) ON DELETE CASCADE,
    sentence_id INTEGER REFERENCES sentences(id) ON DELETE SET NULL,  -- listen cards: the original sentence to play
    prompt_zh   TEXT NOT NULL,
    answer_en   TEXT NOT NULL,
    hint        TEXT NOT NULL DEFAULT '',
    fsrs        TEXT NOT NULL,                    -- fsrs.Card.to_dict() as JSON
    due         TEXT NOT NULL,                    -- 'YYYY-MM-DD HH:MM:SS' UTC, copied out of fsrs for querying
    state       INTEGER NOT NULL DEFAULT 1,       -- fsrs.State: 1 learning, 2 review, 3 relearning
    reps        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (kind, prompt_zh, answer_en),
    UNIQUE (kind, chunk_id)
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS episodes (
    id            INTEGER PRIMARY KEY,
    video_id      TEXT NOT NULL UNIQUE,           -- YouTube id, or "podcast:<hash>"
    title         TEXT NOT NULL,
    channel       TEXT,
    caption_kind  TEXT NOT NULL,              -- manual | generated
    segmented_by  TEXT NOT NULL,              -- punctuation | fallback | whisper (claude in older versions)
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sentences (
    id          INTEGER PRIMARY KEY,
    episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    idx         INTEGER NOT NULL,
    clip_idx    INTEGER NOT NULL,
    start_s     REAL NOT NULL,
    end_s       REAL NOT NULL,
    text        TEXT NOT NULL,
    translation_zh TEXT,                       -- saved Chinese translation, NULL until supplied
    UNIQUE (episode_id, idx)
);

CREATE TABLE IF NOT EXISTS attempts (
    id           INTEGER PRIMARY KEY,
    sentence_id  INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('dictation', 'shadow')),
    user_text    TEXT NOT NULL,
    score        REAL NOT NULL,                -- 0..1, share of reference words matched
    details      TEXT,                         -- JSON: missed / wrong words
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Expressions the learner picked out of a sentence, with the meaning in their own words.
CREATE TABLE IF NOT EXISTS saved_chunks (
    id           INTEGER PRIMARY KEY,
    sentence_id  INTEGER REFERENCES sentences(id) ON DELETE SET NULL,
    pattern      TEXT NOT NULL,
    meaning_zh   TEXT NOT NULL,
    entry_source TEXT NOT NULL DEFAULT 'subtitle', -- subtitle | manual
    context_en   TEXT NOT NULL DEFAULT '',
    context_zh   TEXT NOT NULL DEFAULT '',
    source_label TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    -- Asked to join review before it had a Chinese meaning: its cards are made once the meaning is filled in.
    review_pending INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (pattern, sentence_id)
);

-- Spaced-repetition cards (see CARDS_COLUMNS).
CREATE TABLE IF NOT EXISTS cards ({cards_columns});

CREATE TABLE IF NOT EXISTS reviews (
    id           INTEGER PRIMARY KEY,
    card_id      INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
    said         TEXT NOT NULL DEFAULT '',
    score        REAL,
    was_new      INTEGER NOT NULL DEFAULT 0,
    reviewed_at  TEXT NOT NULL                 -- 'YYYY-MM-DD HH:MM:SS' UTC
);

-- 4/3/2 retelling sessions.
CREATE TABLE IF NOT EXISTS retells (
    id          INTEGER PRIMARY KEY,
    episode_id  INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
    clip_idx    INTEGER,
    topic       TEXT NOT NULL DEFAULT '',
    rounds      TEXT NOT NULL,                 -- JSON list of rounds with transcript and fluency numbers
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Small preferences kept on the server (which review card kinds are on).
CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sentence_annotations (
    id INTEGER PRIMARY KEY,
    sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('word', 'phrase', 'expression')),
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    text TEXT NOT NULL,
    meaning_zh TEXT NOT NULL,
    usage_zh TEXT NOT NULL DEFAULT '',
    example_en TEXT NOT NULL DEFAULT '',
    example_zh TEXT NOT NULL DEFAULT '',
    UNIQUE(sentence_id, start_offset, end_offset)
);

CREATE TABLE IF NOT EXISTS clip_lessons (
    episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    clip_idx INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(episode_id, clip_idx)
);

CREATE TABLE IF NOT EXISTS episode_progress (
    episode_id INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
    sentence_id INTEGER REFERENCES sentences(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sentence_listening (
    sentence_id INTEGER PRIMARY KEY REFERENCES sentences(id) ON DELETE CASCADE,
    ranges TEXT NOT NULL DEFAULT '[]',
    heard INTEGER NOT NULL DEFAULT 0,
    seconds REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listening_events (
    id TEXT PRIMARY KEY,
    sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
    start_s REAL NOT NULL,
    end_s REAL NOT NULL,
    seconds REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Netflix/Hulu stay in their own players. Only visible subtitles, supplied study notes and position are stored.
CREATE TABLE IF NOT EXISTS streaming_sessions (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider IN ('netflix', 'hulu')),
    media_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    position REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(provider, media_id)
);
CREATE TABLE IF NOT EXISTS streaming_cues (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES streaming_sessions(id) ON DELETE CASCADE,
    cue_key TEXT NOT NULL,
    start REAL NOT NULL,
    end REAL NOT NULL,
    text TEXT NOT NULL,
    timing TEXT NOT NULL CHECK (timing IN ('exact', 'observed')),
    translation_zh TEXT,
    annotations TEXT NOT NULL DEFAULT '[]',
    UNIQUE(session_id, cue_key)
);
CREATE TABLE IF NOT EXISTS streaming_lessons (
    session_id INTEGER NOT NULL REFERENCES streaming_sessions(id) ON DELETE CASCADE,
    clip INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(session_id, clip)
);
-- Keep official captions separate: their timing and sentence boundaries need not match English or Codex notes.
CREATE TABLE IF NOT EXISTS streaming_official_subtitles (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES streaming_sessions(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    language TEXT NOT NULL,
    label TEXT NOT NULL,
    cue_key TEXT NOT NULL,
    start REAL NOT NULL,
    end REAL NOT NULL,
    text TEXT NOT NULL,
    UNIQUE(session_id, track_id, cue_key)
);
CREATE INDEX IF NOT EXISTS idx_streaming_official_time ON streaming_official_subtitles(session_id, start);
CREATE INDEX IF NOT EXISTS idx_streaming_recent ON streaming_sessions(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_streaming_cues_time ON streaming_cues(session_id, start);

CREATE INDEX IF NOT EXISTS idx_sentences_episode ON sentences(episode_id, idx);
CREATE INDEX IF NOT EXISTS idx_attempts_sentence ON attempts(sentence_id, kind);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(reps, due);
CREATE INDEX IF NOT EXISTS idx_reviews_time ON reviews(reviewed_at);
CREATE INDEX IF NOT EXISTS idx_annotations_sentence ON sentence_annotations(sentence_id);
CREATE INDEX IF NOT EXISTS idx_listening_time ON listening_events(created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_time ON attempts(created_at);  -- the dashboard's dates
CREATE INDEX IF NOT EXISTS idx_retells_time ON retells(created_at);
-- Deleting sentences (an episode, or re-cutting it) finds these rows through their foreign keys; without the indexes
-- every deleted sentence scans the whole table, which took seconds once there was a few months of listening.
CREATE INDEX IF NOT EXISTS idx_listening_sentence ON listening_events(sentence_id);
CREATE INDEX IF NOT EXISTS idx_chunks_sentence ON saved_chunks(sentence_id);
CREATE INDEX IF NOT EXISTS idx_reviews_card ON reviews(card_id);
""".replace("{cards_columns}", CARDS_COLUMNS)


# Columns added to episodes after v0.2 (podcast episodes are transcribed in the background, YouTube audio too).
EPISODE_COLUMNS = {
    "source": "TEXT NOT NULL DEFAULT 'youtube'",  # youtube | podcast
    "audio_url": "TEXT",  # podcast enclosure
    "image_url": "TEXT",
    "feed_url": "TEXT",
    "status": "TEXT NOT NULL DEFAULT 'ready'",  # ready | processing | failed
    "status_detail": "TEXT NOT NULL DEFAULT ''",
    "channel_url": "TEXT",  # YouTube channel, for 「更多集」
    # A YouTube video's audio, downloaded for precise times and offline playback; the episode stays usable meanwhile.
    "audio_status": "TEXT NOT NULL DEFAULT ''",  # '' | processing | ready | failed
    "audio_detail": "TEXT NOT NULL DEFAULT ''",
    "video_status": "TEXT NOT NULL DEFAULT ''",  # '' | processing | ready | failed
    "video_detail": "TEXT NOT NULL DEFAULT ''",
    "starred_at": "TEXT",  # 'YYYY-MM-DD HH:MM:SS' UTC when the learner starred it, NULL when not starred
}


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r["name"] for r in conn.execute(f"PRAGMA table_info({table})")]


def _rebuild_cards(conn: sqlite3.Connection) -> None:
    """Recreate cards with the current columns and constraints (SQLite's documented 12-step way), keeping every card
    and its review history. Cards from before v5 are all "produce" cards."""
    old = set(_columns(conn, "cards"))
    new = re.findall(r"^\s*(\w+)\s+(?:INTEGER|TEXT|REAL)", CARDS_COLUMNS, re.M)
    derived = {"kind": "'produce'", "note": "CASE WHEN chunk_id IS NULL THEN 'card:' || id ELSE 'chunk:' || chunk_id END"}
    keep = [c for c in new if c in old or c in derived]
    values = [c if c in old else derived[c] for c in keep]
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")  # or dropping the old table would cascade-delete review history
    conn.executescript(
        f"""
        BEGIN;
        CREATE TABLE cards_new ({CARDS_COLUMNS});
        INSERT INTO cards_new ({", ".join(keep)}) SELECT {", ".join(values)} FROM cards;
        DROP TABLE cards;
        ALTER TABLE cards_new RENAME TO cards;
        CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(reps, due);
        COMMIT;
        """
    )
    conn.execute("PRAGMA foreign_keys = ON")


def _migrate(conn: sqlite3.Connection) -> None:
    have = set(_columns(conn, "episodes"))
    for name, decl in EPISODE_COLUMNS.items():
        if name not in have:
            conn.execute(f"ALTER TABLE episodes ADD COLUMN {name} {decl}")
    if "translation_zh" not in _columns(conn, "sentences"):  # v8
        conn.execute("ALTER TABLE sentences ADD COLUMN translation_zh TEXT")
    chunk_columns = set(_columns(conn, "saved_chunks"))
    for name, default in (("entry_source", "subtitle"), ("context_en", ""), ("context_zh", ""),
                          ("source_label", ""), ("notes", "")):
        if name not in chunk_columns:
            conn.execute(f"ALTER TABLE saved_chunks ADD COLUMN {name} TEXT NOT NULL DEFAULT '{default}'")
    if "review_pending" not in chunk_columns:  # v15
        conn.execute("ALTER TABLE saved_chunks ADD COLUMN review_pending INTEGER NOT NULL DEFAULT 0")
    conn.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_chunk_text
                    ON saved_chunks(lower(pattern), meaning_zh) WHERE entry_source = 'manual'""")

    cards = set(_columns(conn, "cards"))
    if "kind" not in cards or "phrase_id" in cards:  # v5 added kinds, v7 dropped phrase_id
        _rebuild_cards(conn)
    # v7: the AI features are gone.
    for table, column in (("sentences", "analysis"), ("saved_chunks", "usage_zh"), ("saved_chunks", "example"),
                          ("saved_chunks", "example_zh"), ("retells", "feedback")):
        if column in _columns(conn, table):
            conn.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
    conn.execute("DROP TABLE IF EXISTS conversations")
    conn.execute("DROP TABLE IF EXISTS phrases")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_note ON cards(note)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_chunk ON cards(chunk_id)")  # after any rebuild of cards
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_sentence ON cards(sentence_id)")


def init_db() -> int:
    """Create missing tables and columns; returns the schema version the database had before (0 for v0.1)."""
    with connect() as conn:
        before = conn.execute("PRAGMA user_version").fetchone()[0]
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    return before


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    fresh = not DB_PATH.exists()  # also covers deleting data/app.db while the server runs
    if fresh:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    if fresh:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def loads(value: str | None):
    return json.loads(value) if value else None

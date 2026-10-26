"""Review card kinds: produce / listen / cloze siblings, burying, the kinds setting, and migrating old cards."""

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
from app.review import cloze_blanks, cloze_tokens
from helpers import SENTENCE, save_chunk


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    with TestClient(app.main.app) as c:
        yield c


@pytest.mark.parametrize(
    "answer, hint, blanks",
    [
        ("I ended up working late again.", "end up + doing", [1, 2]),
        ("I try to spread the work out.", "spread the work out", [3, 4, 5, 6]),
        ("Honestly, I'm not gonna lie, it was tough.", "I'm not gonna lie", [1, 2, 3, 4]),
        ("Do you happen to know where it is?", "Do you happen to + do", [0, 1, 2, 3]),
        ("The meeting got pushed back.", "call it a day", []),  # not in the sentence: no cloze card
        ("Anything works.", "", []),
    ],
)
def test_cloze_blanks(answer, hint, blanks):
    assert cloze_blanks(answer, hint) == blanks


def test_cloze_tokens_keep_punctuation_outside_the_blank():
    tokens = cloze_tokens("Honestly, I'm not gonna lie, it was tough.", "I'm not gonna lie")
    assert [t["text"] for t in tokens if t["blank"]] == ["I'm", "not", "gonna", "lie"]
    assert tokens[4]["after"] == ","


def test_listen_card_plays_the_original_sentence(client):
    save_chunk(client)
    client.put("/api/review/kinds", json={"kinds": ["listen"]})
    card = client.get("/api/review").json()["card"]
    assert card["kind"] == "listen"
    assert card["answer_en"] == SENTENCE and card["prompt_zh"] == "分摊" and card["hint"] == "spread the work out"
    assert card["listen"] == {"episode_id": 1, "video_id": "arj7oStGLkU", "source": "youtube", "audio": False,
                              "start": 19.4, "end": 23.9, "sentence_idx": 0}
    with app.db.connect() as conn:
        conn.execute("UPDATE episodes SET audio_status = 'ready' WHERE id = 1")
    assert client.get("/api/review").json()["card"]["listen"]["audio"] is True  # downloaded audio plays locally


def test_siblings_wait_for_another_day(client):
    save_chunk(client)
    first = client.get("/api/review").json()["card"]
    assert first["kind"] == "produce"
    state = client.post(f"/api/review/{first['id']}", json={"rating": 4}).json()  # Easy: done for days
    assert state["card"] is None  # listen and cloze are siblings: not today
    assert state["summary"]["new_available"] == 0

    with app.db.connect() as conn:  # pretend that review was yesterday
        conn.execute("UPDATE reviews SET reviewed_at = datetime('now', '-1 day', '-1 hour')")
    nxt = client.get("/api/review").json()["card"]
    assert nxt["kind"] in {"listen", "cloze"}


def test_kinds_setting_filters_the_queue(client):
    save_chunk(client)
    state = client.put("/api/review/kinds", json={"kinds": ["cloze"]}).json()
    assert state["summary"]["kinds"] == ["cloze"] and state["summary"]["total"] == 1
    card = state["card"]
    assert card["kind"] == "cloze"
    assert [t["text"] for t in card["cloze"] if t["blank"]] == ["spread", "the", "work", "out"]
    assert client.put("/api/review/kinds", json={"kinds": []}).status_code == 422


def test_v4_database_gets_card_kinds_and_keeps_review_history(tmp_path, monkeypatch):
    db_path = tmp_path / "v4.db"
    monkeypatch.setattr(app.db, "DB_PATH", db_path)
    v4_cards = """
        CREATE TABLE cards (
            id INTEGER PRIMARY KEY, source TEXT NOT NULL,
            chunk_id INTEGER UNIQUE REFERENCES saved_chunks(id) ON DELETE CASCADE,
            phrase_id INTEGER REFERENCES phrases(id) ON DELETE CASCADE,
            prompt_zh TEXT NOT NULL, answer_en TEXT NOT NULL, hint TEXT NOT NULL DEFAULT '',
            fsrs TEXT NOT NULL, due TEXT NOT NULL, state INTEGER NOT NULL DEFAULT 1, reps INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (prompt_zh, answer_en));
    """
    old = sqlite3.connect(db_path)
    schema = app.db.SCHEMA
    before_cards, after_cards = schema.split("-- Spaced-repetition cards (see CARDS_COLUMNS).")
    old.executescript(before_cards + v4_cards + after_cards.split(");", 1)[1].replace("CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(reps, due);", ""))
    old.execute("INSERT INTO cards (source, prompt_zh, answer_en, hint, fsrs, due, reps, state) VALUES "
                "('talk', '我去徒步了', 'I went hiking', 'went hiking', '{\"card_id\": 1, \"state\": 2, \"step\": null, "
                "\"stability\": 30, \"difficulty\": 5, \"due\": \"2030-01-01T00:00:00+00:00\", \"last_review\": null}', "
                "'2030-01-01 00:00:00', 4, 2)")
    old.execute("INSERT INTO reviews (card_id, rating, reviewed_at) VALUES (1, 3, '2026-10-01 10:00:00')")
    old.execute("CREATE TABLE phrases (id INTEGER PRIMARY KEY, zh TEXT NOT NULL)")  # gone with the AI features in v7
    old.execute("CREATE TABLE conversations (id INTEGER PRIMARY KEY, scenario TEXT NOT NULL)")
    old.execute("PRAGMA user_version = 4")
    old.commit()
    old.close()

    with TestClient(app.main.app) as c:
        cards = {x["kind"]: x for x in c.get("/api/cards").json()}
        assert set(cards) == {"produce", "listen", "cloze"}
        assert cards["produce"]["id"] == 1 and cards["produce"]["reps"] == 4  # schedule kept
        assert cards["listen"]["reps"] == 0 and cards["cloze"]["reps"] == 0
    with app.db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM reviews WHERE card_id = 1").fetchone()[0] == 1
        assert conn.execute("PRAGMA user_version").fetchone()[0] == app.db.SCHEMA_VERSION
        notes = {r[0] for r in conn.execute("SELECT note FROM cards")}
        assert len(notes) == 1  # all three are siblings
        assert "phrase_id" not in {r["name"] for r in conn.execute("PRAGMA table_info(cards)")}
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        assert not tables & {"phrases", "conversations", "cards_new"}

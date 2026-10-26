"""Review (FSRS) of saved expressions, and 4/3/2 retelling."""

import sqlite3
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
import app.review
from app.review import human_interval
from helpers import save_chunk


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    with TestClient(app.main.app) as c:
        yield c


def test_saving_an_expression_creates_review_cards(client):
    save_chunk(client)
    state = client.get("/api/review").json()
    card = state["card"]
    assert card["kind"] == "produce" and card["is_new"] and card["source"] == "chunk"
    assert card["prompt_zh"] == "分摊" and card["answer_en"] == "spread the work out"
    assert card["hint"] == "They might ______ ___ ____ ___ a little like this."  # the original sentence, blanked
    assert set(card["intervals"]) == {"1", "2", "3", "4"}
    # One expression gives three sibling cards: produce, listen, cloze.
    assert state["summary"]["new_available"] == 3 and state["summary"]["due"] == 0


def test_review_flow_learning_steps_then_graduation(client):
    save_chunk(client)
    card_id = client.get("/api/review").json()["card"]["id"]

    # Good on a new card: next learning step is 10 minutes away, which is inside the learn-ahead window.
    state = client.post(f"/api/review/{card_id}", json={"rating": 3, "said": "spread the work", "score": 0.8}).json()
    assert state["card"]["id"] == card_id and not state["card"]["is_new"]
    assert state["summary"]["reviewed_today"] == 1 and state["summary"]["new_available"] == 0

    # Good again graduates it to days away: nothing left today.
    state = client.post(f"/api/review/{card_id}", json={"rating": 3}).json()
    assert state["card"] is None
    assert state["summary"]["next_due"] is not None

    produce = next(c for c in client.get("/api/cards").json() if c["id"] == card_id)
    assert produce["reps"] == 2 and produce["state"] == 2


def test_new_cards_per_day_limit(client, monkeypatch):
    monkeypatch.setattr(app.review, "NEW_CARDS_PER_DAY", 1)
    save_chunk(client, pattern="a little", text="Just a little more.")
    save_chunk(client, pattern="like this", text="Do it like this.")
    first = client.get("/api/review").json()
    assert first["summary"]["new_total"] == 6 and first["summary"]["new_available"] == 1
    state = client.post(f"/api/review/{first['card']['id']}", json={"rating": 4}).json()  # Easy: straight to review
    assert state["card"] is None and state["summary"]["new_available"] == 0


def test_an_expression_not_found_in_its_sentence_gets_no_cloze_card(client):
    save_chunk(client, pattern="call it a day")  # edited to something the sentence doesn't contain
    cards = client.get("/api/cards").json()
    assert sorted(c["kind"] for c in cards) == ["listen", "produce"]
    produce = next(c for c in cards if c["kind"] == "produce")
    assert produce["hint"] == "They might spread the work out a little like this."


def test_upgrade_from_v01_backfills_cards_once(tmp_path, monkeypatch):
    db_path = tmp_path / "old.db"
    monkeypatch.setattr(app.db, "DB_PATH", db_path)
    # A v0.1 database: user_version 0, sentences with AI notes, one chunk saved from them.
    old = sqlite3.connect(db_path)
    old.executescript(
        """
        CREATE TABLE episodes (id INTEGER PRIMARY KEY, video_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, channel TEXT,
                               caption_kind TEXT NOT NULL, segmented_by TEXT NOT NULL,
                               created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE sentences (id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
                                idx INTEGER NOT NULL, clip_idx INTEGER NOT NULL, start_s REAL NOT NULL, end_s REAL NOT NULL,
                                text TEXT NOT NULL, analysis TEXT, UNIQUE (episode_id, idx));
        CREATE TABLE saved_chunks (id INTEGER PRIMARY KEY, sentence_id INTEGER REFERENCES sentences(id) ON DELETE SET NULL,
                                   pattern TEXT NOT NULL, meaning_zh TEXT NOT NULL, usage_zh TEXT NOT NULL DEFAULT '',
                                   example TEXT NOT NULL DEFAULT '', example_zh TEXT NOT NULL DEFAULT '',
                                   created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (pattern, sentence_id));
        INSERT INTO episodes (video_id, title, caption_kind, segmented_by) VALUES ('arj7oStGLkU', 'T', 'manual', 'punctuation');
        INSERT INTO sentences (episode_id, idx, clip_idx, start_s, end_s, text, analysis)
             VALUES (1, 0, 0, 1, 3, 'I ended up staying.', '{"translation_zh": "我最后留下了。"}');
        INSERT INTO saved_chunks (sentence_id, pattern, meaning_zh, example, example_zh)
             VALUES (1, 'ended up', '结果', 'I ended up staying.', '我最后留下了。');
        """
    )
    old.commit()
    old.close()

    with TestClient(app.main.app) as c:
        cards = c.get("/api/cards").json()
        assert sorted(x["kind"] for x in cards) == ["cloze", "listen", "produce"]
        assert c.get("/api/chunks").json()[0]["pattern"] == "ended up"
        for card in cards:
            c.delete(f"/api/cards/{card['id']}")
    with app.db.connect() as conn:  # the AI columns are gone
        assert "analysis" not in {r["name"] for r in conn.execute("PRAGMA table_info(sentences)")}
        assert "example" not in {r["name"] for r in conn.execute("PRAGMA table_info(saved_chunks)")}
    with TestClient(app.main.app) as c:  # restart: the deleted cards must not come back
        assert c.get("/api/cards").json() == []


ROUND = {"limit_seconds": 120, "total_seconds": 110, "speaking_seconds": 80, "transcript": "he always wait", "words": 60, "wpm": 33, "pauses": 5, "longest_pause": 2.5}


def test_retell_of_a_clip_carries_the_video_title(client):
    with app.db.connect() as conn:
        conn.execute(
            "INSERT INTO episodes (video_id, title, caption_kind, segmented_by) VALUES ('abcdefghijk', 'My video', 'manual', 'punctuation')"
        )
        conn.execute("INSERT INTO sentences (episode_id, idx, clip_idx, start_s, end_s, text) VALUES (1, 0, 0, 0, 2, 'Hello there.')")
    retell = client.post("/api/retells", json={"episode_id": 1, "clip_idx": 0, "rounds": [ROUND]}).json()
    assert retell["title"] == "My video" and "feedback" not in retell


def test_retells_are_saved_and_listed(client):
    res = client.post("/api/retells", json={"topic": "介绍你的工作", "rounds": [ROUND, ROUND, ROUND]})
    assert res.status_code == 200
    retell = res.json()
    assert [r["wpm"] for r in retell["rounds"]] == [33, 33, 33]
    assert client.get("/api/retells").json()[0]["id"] == retell["id"]
    assert client.post(f"/api/retells/{retell['id']}/feedback").status_code in (404, 405)  # no more AI feedback


def test_retell_needs_a_subject(client):
    assert client.post("/api/retells", json={"rounds": [ROUND]}).status_code == 422


@pytest.mark.parametrize(
    "delta, text",
    [(timedelta(seconds=30), "1分钟"), (timedelta(minutes=10), "10分钟"), (timedelta(hours=5), "5小时"),
     (timedelta(days=3), "3天"), (timedelta(days=60), "2个月"), (timedelta(days=500), "1.4年")],
)
def test_human_interval(delta, text):
    assert human_interval(delta) == text

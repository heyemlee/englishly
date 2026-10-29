"""Manually collected vocabulary shares the notebook and FSRS without needing an episode."""

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
from helpers import save_chunk


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    with TestClient(app.main.app) as c:
        yield c


def manual(client, **patch):
    return client.post("/api/chunks/manual", json={"pattern": "come across", "meaning_zh": "偶然发现", **patch})


def test_manual_entry_needs_no_episode_and_uses_speech_fallback(client):
    response = manual(client, pattern="  come   across  ", source_label=" 阅读课 ", notes="偶然看到，不是专门去找")
    assert response.status_code == 200
    row = client.get("/api/chunks").json()[0]
    assert row["sentence_id"] is None and row["episode_id"] is None and row["entry_source"] == "manual"
    assert row["pattern"] == "come across" and row["source_label"] == "阅读课" and row["notes"]
    assert row["in_review"] is True and row["has_audio"] is False
    cards = client.get("/api/cards").json()
    assert {c["kind"] for c in cards} == {"produce", "listen"}
    assert all(c["source"] == "manual" for c in cards)
    listen = client.put("/api/review/kinds", json={"kinds": ["listen"]}).json()["card"]
    assert listen["listen"] is None and listen["answer_en"] == "come across"


def test_example_creates_cloze_and_keeps_sibling_burying(client):
    response = manual(client, context_en="I come across new words every day.", context_zh="我每天都会遇到新词。")
    assert response.status_code == 200
    row = client.get("/api/chunks").json()[0]
    assert row["context_zh"] == "我每天都会遇到新词。"
    cards = client.get("/api/cards").json()
    assert {c["kind"] for c in cards} == {"produce", "listen", "cloze"}
    produce = next(c for c in cards if c["kind"] == "produce")
    assert produce["answer_en"] == "come across" and "____ ______" in produce["hint"]
    cloze = client.put("/api/review/kinds", json={"kinds": ["cloze"]}).json()["card"]
    assert [t["text"] for t in cloze["cloze"] if t["blank"]] == ["come", "across"]
    assert client.post(f"/api/review/{cloze['id']}", json={"rating": 4}).status_code == 200
    state = client.put("/api/review/kinds", json={"kinds": ["produce", "listen", "cloze"]}).json()
    assert state["card"] is None  # the siblings still wait until another day


def test_unrelated_example_does_not_create_impossible_cloze(client):
    assert manual(client, context_en="This is unrelated.").status_code == 200
    assert {c["kind"] for c in client.get("/api/cards").json()} == {"produce", "listen"}


def test_record_only_survives_restart_then_enrolls_without_resetting_progress(client):
    response = manual(client, add_to_review=False)
    chunk_id = response.json()["id"]
    assert client.get("/api/cards").json() == []
    assert client.get("/api/chunks").json()[0]["in_review"] is False
    with TestClient(app.main.app) as restarted:
        assert restarted.get("/api/review").json()["card"] is None
    assert client.post(f"/api/chunks/{chunk_id}/review").status_code == 200
    card = client.get("/api/review").json()["card"]
    client.post(f"/api/review/{card['id']}", json={"rating": 3})
    with app.db.connect() as conn:
        before = [tuple(r) for r in conn.execute("SELECT * FROM cards ORDER BY id")]
    assert client.post(f"/api/chunks/{chunk_id}/review").status_code == 200
    with app.db.connect() as conn:
        assert [tuple(r) for r in conn.execute("SELECT * FROM cards ORDER BY id")] == before
        assert conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0] == 1
    assert client.get("/api/chunks").json()[0]["in_review"] is True


def test_duplicate_and_whitespace_validation_is_atomic(client):
    assert manual(client).status_code == 200
    assert manual(client, pattern="Come Across").status_code == 409
    assert manual(client, meaning_zh="给人以某种印象").status_code == 200  # another sense is a separate entry
    assert manual(client, pattern="   ").status_code == 400
    assert manual(client, pattern="a" * 201).status_code == 422
    assert len(client.get("/api/chunks").json()) == 2
    assert client.post("/api/chunks/999/review").status_code == 404


def test_existing_subtitle_card_conflict_does_not_leave_partial_entry(client):
    save_chunk(client, pattern="come across", meaning_zh="偶然发现", text="I come across new words.")
    assert manual(client).status_code == 409
    assert len(client.get("/api/chunks").json()) == 1
    record = manual(client, add_to_review=False).json()
    assert client.post(f"/api/chunks/{record['id']}/review").status_code == 409
    assert len(client.get("/api/cards").json()) == 3


def test_manual_meaning_edit_and_delete_keep_existing_semantics(client):
    chunk_id = manual(client).json()["id"]
    card = client.get("/api/review").json()["card"]
    client.post(f"/api/review/{card['id']}", json={"rating": 3})
    with app.db.connect() as conn:
        before = [tuple(r) for r in conn.execute("SELECT id, fsrs, due, reps FROM cards ORDER BY id")]
    assert client.patch(f"/api/chunks/{chunk_id}", json={"meaning_zh": "偶然遇见；无意中发现"}).status_code == 200
    with app.db.connect() as conn:
        assert [tuple(r) for r in conn.execute("SELECT id, fsrs, due, reps FROM cards ORDER BY id")] == before
    assert all(c["prompt_zh"] == "偶然遇见；无意中发现" for c in client.get("/api/cards").json())
    client.delete(f"/api/chunks/{chunk_id}")
    assert client.get("/api/cards").json() == [] and client.get("/api/chunks").json() == []


def test_v9_migration_preserves_existing_cards_and_reviews(client):
    chunk = save_chunk(client)
    card = client.get("/api/review").json()["card"]
    client.post(f"/api/review/{card['id']}", json={"rating": 3})
    with app.db.connect() as conn:
        before = [tuple(r) for r in conn.execute("SELECT * FROM cards ORDER BY id")]
        conn.execute("DROP INDEX idx_manual_chunk_text")
        for column in ("entry_source", "context_en", "context_zh", "source_label", "notes"):
            conn.execute(f"ALTER TABLE saved_chunks DROP COLUMN {column}")
        conn.execute("PRAGMA user_version = 9")
    with TestClient(app.main.app) as restarted:
        old = restarted.get("/api/chunks").json()[0]
        assert old["id"] == chunk["id"] and old["entry_source"] == "subtitle" and old["in_review"] is True
        assert manual(restarted, add_to_review=False).status_code == 200
    with app.db.connect() as conn:
        assert [tuple(r) for r in conn.execute("SELECT * FROM cards ORDER BY id")] == before
        assert conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0] == 1
        assert conn.execute("PRAGMA user_version").fetchone()[0] == app.db.SCHEMA_VERSION


def test_english_only_entry_waits_for_its_meaning_then_joins_review(client):
    """The learner adds just the word; Codex fills in the meaning and an example later, and only then are cards made."""
    entry = manual(client, pattern=" elevated ", meaning_zh="\n  ").json()
    assert entry["meaning_zh"] == "" and entry["review_pending"] is True and entry["in_review"] is False
    assert client.get("/api/cards").json() == []
    assert manual(client, pattern="Elevated", meaning_zh="").status_code == 409  # the same word twice
    row = client.get("/api/chunks").json()[0]
    assert row["review_pending"] is True and row["in_review"] is False

    assert client.patch(f"/api/chunks/{entry['id']}", json={"meaning_zh": "  "}).status_code == 400
    filled = client.patch(f"/api/chunks/{entry['id']}", json={
        "meaning_zh": "提高的；升高的", "context_en": "Stress keeps his blood pressure elevated.",
        "context_zh": "压力让他的血压一直偏高。",
    }).json()
    assert filled["review_pending"] is False and filled["in_review"] is True
    assert filled["context_zh"] == "压力让他的血压一直偏高。"
    cards = client.get("/api/cards").json()
    assert {c["kind"] for c in cards} == {"produce", "listen", "cloze"}  # made from the example filled in
    assert all(c["prompt_zh"] == "提高的；升高的" for c in cards)


def test_record_only_entry_without_meaning_stays_out_of_review(client):
    entry = manual(client, pattern="elevated", meaning_zh="", add_to_review=False).json()
    assert entry["review_pending"] is False
    client.patch(f"/api/chunks/{entry['id']}", json={"meaning_zh": "提高的"})
    assert client.get("/api/cards").json() == []
    # Asking for review before the meaning exists waits for it.
    other = manual(client, pattern="come across", meaning_zh="", add_to_review=False).json()
    assert client.post(f"/api/chunks/{other['id']}/review").json()["review_pending"] is True
    assert client.get("/api/cards").json() == []
    client.patch(f"/api/chunks/{other['id']}", json={"context_en": "I came across it."})  # still no meaning
    assert client.get("/api/cards").json() == []
    assert client.patch(f"/api/chunks/{other['id']}", json={"meaning_zh": "偶然发现"}).json()["in_review"] is True


def test_upgrade_adds_review_pending(client):
    manual(client)
    with app.db.connect() as conn:  # back to a v14 database
        conn.execute("ALTER TABLE saved_chunks DROP COLUMN review_pending")
        conn.execute("PRAGMA user_version = 14")
    assert app.db.init_db() == 14
    assert client.get("/api/chunks").json()[0]["review_pending"] is False

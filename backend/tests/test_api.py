import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
from app.youtube import Snippet, Transcript, Video

AUTO_CAPTIONS = [
    Snippet("so in college I was", 0.0, 3.0),
    Snippet("a government major which means", 2.0, 3.0),
    Snippet("I had to write a lot of papers", 4.0, 3.0),
]
MANUAL_CAPTIONS = [
    Snippet("So in college, I was a government major,", 0.0, 4.0),
    Snippet("which means I had to write a lot of papers.", 4.0, 3.0),
]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(
        app.main,
        "fetch_video",
        lambda vid: Video("Test video", "Test channel", None, Transcript(MANUAL_CAPTIONS, is_generated=False)),
    )
    with TestClient(app.main.app) as c:
        yield c


def test_import_splits_by_punctuation(client):
    res = client.post("/api/episodes", json={"url": "https://youtu.be/arj7oStGLkU"})
    assert res.status_code == 200, res.text
    ep = res.json()
    assert ep["segmented_by"] == "punctuation" and ep["caption_kind"] == "manual" and ep["warning"] is None
    assert [s["text"] for s in ep["sentences"]] == [
        "So in college, I was a government major, which means I had to write a lot of papers."
    ]
    assert ep["sentences"][0]["start"] == 0.0

    assert client.get("/api/episodes/by-video/arj7oStGLkU").json()["id"] == ep["id"]  # for the Chrome extension
    assert client.get("/api/episodes/by-video/xxxxxxxxxxx").status_code == 404

    # Importing the same video again returns the existing episode.
    again = client.post("/api/episodes", json={"url": "arj7oStGLkU"}).json()
    assert again["id"] == ep["id"]
    assert len(client.get("/api/episodes").json()) == 1


def test_auto_captions_without_punctuation_are_cut_by_length(client, monkeypatch):
    monkeypatch.setattr(
        app.main, "fetch_video", lambda vid: Video("T", "C", None, Transcript(AUTO_CAPTIONS, is_generated=True))
    )
    ep = client.post("/api/episodes", json={"url": "arj7oStGLkU"}).json()
    assert ep["segmented_by"] == "fallback" and ep["caption_kind"] == "generated"
    assert "下载音频" in ep["warning"]  # Whisper can re-cut it by punctuation, for free
    assert " ".join(s["text"] for s in ep["sentences"]) == " ".join(s.text for s in AUTO_CAPTIONS)


def test_attempts_and_saved_expressions(client):
    ep = client.post("/api/episodes", json={"url": "arj7oStGLkU"}).json()
    sid = ep["sentences"][0]["id"]
    assert client.post("/api/attempts", json={"sentence_id": sid, "kind": "dictation", "user_text": "which means", "score": 0.4}).status_code == 200
    assert client.post("/api/attempts", json={"sentence_id": sid, "kind": "shadow", "user_text": "x", "score": 1.5}).status_code == 422

    saved = client.post("/api/chunks", json={"sentence_id": sid, "pattern": " which  means ", "meaning_zh": "也就是说"}).json()
    assert saved["pattern"] == "which means"
    # Saving it again updates the meaning instead of adding a second one.
    again = client.post("/api/chunks", json={"sentence_id": sid, "pattern": "which means", "meaning_zh": "这就意味着"}).json()
    assert again["id"] == saved["id"] and again["meaning_zh"] == "这就意味着"
    assert client.post("/api/chunks", json={"sentence_id": sid, "pattern": "papers", "meaning_zh": "  "}).status_code == 400
    assert client.post("/api/chunks", json={"sentence_id": 999, "pattern": "papers", "meaning_zh": "论文"}).status_code == 404

    detail = client.get(f"/api/episodes/{ep['id']}").json()
    assert detail["sentences"][0]["dictation_score"] == 0.4
    assert detail["sentences"][0]["saved"] == [{"id": saved["id"], "pattern": "which means", "meaning_zh": "这就意味着"}]
    listed = client.get("/api/chunks").json()
    assert listed[0]["sentence_text"] == ep["sentences"][0]["text"] and listed[0]["video_id"] == "arj7oStGLkU"
    assert {c["kind"] for c in client.get("/api/cards").json()} == {"produce", "listen", "cloze"}

    client.delete(f"/api/chunks/{saved['id']}")
    assert client.get("/api/chunks").json() == []
    assert client.get("/api/cards").json() == []  # its cards go with it


def test_timing_patch_validates(client):
    ep = client.post("/api/episodes", json={"url": "arj7oStGLkU"}).json()
    sid = ep["sentences"][0]["id"]
    assert client.patch(f"/api/sentences/{sid}", json={"start": 0.2}).json()["start"] == 0.2
    assert client.patch(f"/api/sentences/{sid}", json={"end": 0.1}).status_code == 400


def test_bad_url_is_a_400(client):
    res = client.post("/api/episodes", json={"url": "https://example.com/video"})
    assert res.status_code == 400
    assert "YouTube" in res.json()["detail"]


def test_health(client):
    health = client.get("/api/health").json()
    assert set(health) == {"ok", "cloud", "login", "whisper"}
    assert health["cloud"] is False and health["login"] is False  # on the Mac: no password, importing on

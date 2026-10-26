"""Saved Chinese remains usable independently of the removed translation provider."""

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
from helpers import add_sentence


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    with TestClient(app.main.app) as c:
        yield c


def test_saved_translations_survive_reinitialization_and_are_returned_with_sentences(client):
    translated_id = add_sentence("I ended up staying.")
    untranslated_id = add_sentence("See you tomorrow.")
    with app.db.connect() as conn:
        conn.execute("UPDATE sentences SET translation_zh = ? WHERE id = ?", ("我最后还是留下了。", translated_id))
        original = [tuple(row) for row in conn.execute(
            "SELECT id, episode_id, idx, clip_idx, start_s, end_s, text, translation_zh FROM sentences ORDER BY idx"
        )]
        episode_id = original[0][1]

    app.db.init_db()

    for path in (f"/api/episodes/{episode_id}", "/api/episodes/by-video/arj7oStGLkU"):
        response = client.get(path)
        assert response.status_code == 200
        sentences = response.json()["sentences"]
        assert [(s["id"], s["text"], s["translation_zh"]) for s in sentences] == [
            (translated_id, "I ended up staying.", "我最后还是留下了。"),
            (untranslated_id, "See you tomorrow.", None),
        ]
    with app.db.connect() as conn:
        assert [tuple(row) for row in conn.execute(
            "SELECT id, episode_id, idx, clip_idx, start_s, end_s, text, translation_zh FROM sentences ORDER BY idx"
        )] == original

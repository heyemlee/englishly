"""Foreign keys that deletions cascade through have indexes, or deleting an episode scans whole tables."""

from fastapi.testclient import TestClient

import app.db
import app.main


def test_cascades_have_indexes(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    with TestClient(app.main.app), app.db.connect() as conn:
        def indexed(table: str) -> set[str]:
            return {conn.execute(f"PRAGMA index_info({r['name']})").fetchone()["name"]
                    for r in conn.execute(f"PRAGMA index_list({table})")}
        assert "sentence_id" in indexed("listening_events")
        assert "sentence_id" in indexed("saved_chunks")
        assert {"chunk_id", "sentence_id"} <= indexed("cards")
        assert "card_id" in indexed("reviews")

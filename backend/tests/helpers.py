"""Shared by the review tests: expressions are saved from a sentence of an imported video."""

import app.db

SENTENCE = "They might spread the work out a little like this."


def add_sentence(text: str = SENTENCE) -> int:
    with app.db.connect() as conn:
        ep = conn.execute("SELECT id FROM episodes WHERE video_id = 'arj7oStGLkU'").fetchone()
        ep_id = ep["id"] if ep else conn.execute(
            "INSERT INTO episodes (video_id, title, caption_kind, segmented_by) VALUES ('arj7oStGLkU', 'T', 'manual', 'punctuation')"
        ).lastrowid
        idx = conn.execute("SELECT COUNT(*) FROM sentences WHERE episode_id = ?", (ep_id,)).fetchone()[0]
        return conn.execute(
            "INSERT INTO sentences (episode_id, idx, clip_idx, start_s, end_s, text) VALUES (?, ?, 0, ?, ?, ?)",
            (ep_id, idx, 19.4 + idx * 5, 23.9 + idx * 5, text),
        ).lastrowid


def save_chunk(client, pattern: str = "spread the work out", meaning_zh: str = "分摊", text: str = SENTENCE) -> dict:
    body = {"sentence_id": add_sentence(text), "pattern": pattern, "meaning_zh": meaning_zh}
    return client.post("/api/chunks", json=body).json()

"""Dashboard numbers, 误听本 and podcasts (RSS + Whisper job)."""

import asyncio
import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
import app.media as media
import app.podcasts as podcasts
from app.segment import Word
from app.stats import streak

FEED = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>Easy Talk</title>
  <itunes:author>Jane</itunes:author>
  <itunes:image href="https://img.test/show.jpg"/>
  <item>
    <title>Ordering coffee</title>
    <guid>ep-2</guid>
    <pubDate>Tue, 20 Oct 2026 08:00:00 GMT</pubDate>
    <itunes:duration>12:30</itunes:duration>
    <description>&lt;p&gt;How to &lt;b&gt;order&lt;/b&gt; coffee.&lt;/p&gt;</description>
    <enclosure url="https://cdn.test/ep2.mp3" type="audio/mpeg" length="1"/>
  </item>
  <item>
    <title>A video episode</title>
    <enclosure url="https://cdn.test/ep1.mp4" type="video/mp4" length="1"/>
  </item>
</channel>
</rss>"""

WORDS = [Word(t, i * 0.4, i * 0.4 + 0.35, 0) for i, t in enumerate("Hi there, welcome back. Today we order coffee like a pro.".split())]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(media, "AUDIO_DIR", tmp_path / "audio")
    with TestClient(app.main.app) as c:
        yield c


def add_episode(conn, video_id="abcdefghijk", **extra) -> int:
    cols = {"video_id": video_id, "title": "T", "caption_kind": "manual", "segmented_by": "punctuation", **extra}
    cur = conn.execute(f"INSERT INTO episodes ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", list(cols.values()))
    return cur.lastrowid


def test_streak_counts_back_from_today_or_yesterday():
    today = date(2026, 10, 23)
    days = {(today - timedelta(days=i)).isoformat() for i in (1, 2, 3, 5)}
    assert streak(days, today) == 3  # nothing today yet: yesterday, -2, -3
    assert streak(days | {today.isoformat()}, today) == 4
    assert streak(set(), today) == 0


def test_stats(client):
    with app.db.connect() as conn:
        ep = add_episode(conn)
        conn.execute("INSERT INTO sentences (episode_id, idx, clip_idx, start_s, end_s, text) VALUES (?, 0, 0, 0, 2, 'Hello there.')", (ep,))
        conn.executemany(
            "INSERT INTO attempts (sentence_id, kind, user_text, score) VALUES (1, ?, 'x', ?)",
            [("dictation", 0.5), ("dictation", 1.0), ("shadow", 0.8)],
        )
        conn.execute(
            "INSERT INTO cards (source, prompt_zh, answer_en, fsrs, due, reps, state) VALUES ('manual', '你好', 'Hi', ?, '2030-01-01 00:00:00', 3, 2)",
            (json.dumps({"stability": 40}),),
        )
        conn.execute("INSERT INTO retells (topic, rounds) VALUES ('work', ?)", (json.dumps([{"wpm": 60, "pauses": 5}, {"wpm": 80, "pauses": 2}]),))
    s = client.get("/api/stats").json()
    assert s["streak"] == 1 and s["active_days"] == 1
    today = s["daily"][-1]
    assert today["date"] == date.today().isoformat()
    assert (today["dictation"], today["dictation_avg"], today["shadow"], today["sentences"]) == (2, 0.75, 1, 1)
    assert len(s["daily"]) == 30
    assert s["totals"]["cards_mature"] == 1 and s["totals"]["sentences_practiced"] == 1
    assert s["recent"]["dictation"] == 0.75
    assert s["retells"][0]["wpm"] == [60, 80]


def test_mishears_groups_words(client):
    with app.db.connect() as conn:
        ep = add_episode(conn)
        conn.execute(
            "INSERT INTO sentences (episode_id, idx, clip_idx, start_s, end_s, text) VALUES (?, 3, 0, 0, 2, 'I want to go to the store.')",
            (ep,),
        )
        for details in (
            {"missed": ["to", "the"], "wrong": [{"expected": "want to", "got": "wanna"}]},
            {"missed": ["to"], "wrong": [{"expected": "store", "got": "stall"}]},
        ):
            conn.execute(
                "INSERT INTO attempts (sentence_id, kind, user_text, score, details) VALUES (1, 'dictation', 'x', 0.5, ?)",
                (json.dumps(details),),
            )
    m = client.get("/api/mishears").json()
    top = {t["word"]: t for t in m["top"]}
    assert top["to"]["count"] == 3 and top["to"]["missed"] == 2 and top["to"]["function_word"]
    assert top["store"]["heard_as"] == [{"text": "stall", "count": 1}]
    assert top["to"]["examples"][0]["sentence_idx"] == 3
    assert m["total"] == 6 and m["function_share"] == pytest.approx(4 / 6, abs=0.001)


def test_parse_feed():
    data = podcasts.parse_feed(FEED, "https://feed.test/rss")
    assert data["title"] == "Easy Talk" and data["image"] == "https://img.test/show.jpg"
    assert len(data["episodes"]) == 1  # the video enclosure is skipped
    ep = data["episodes"][0]
    assert (ep["guid"], ep["duration"], ep["published"], ep["description"]) == ("ep-2", 750, "2026-10-20", "How to order coffee.")
    with pytest.raises(podcasts.PodcastError):
        podcasts.parse_feed(b"<html><body>nope</body></html>", "x")
    assert podcasts.parse_duration("1:02:03") == 3723 and podcasts.parse_duration("90") == 90


def test_podcast_import_transcribe_and_serve(client, monkeypatch, tmp_path):
    async def fake_fetch(url):
        return podcasts.parse_feed(FEED, url)

    async def fake_download(url, dest, episode_id):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"ID3fake-mp3-bytes")

    monkeypatch.setattr(podcasts, "fetch_feed", fake_fetch)
    monkeypatch.setattr(podcasts, "_download", fake_download)
    monkeypatch.setattr(media, "whisper_status", lambda: (True, ""))
    monkeypatch.setattr(media, "transcribe", lambda path: WORDS)

    listing = client.get("/api/podcasts/feed", params={"url": "https://feed.test/rss"}).json()
    assert listing["episodes"][0]["episode_id"] is None
    res = client.post("/api/podcasts/import", json={"feed_url": "https://feed.test/rss", "guid": "ep-2"}).json()
    ep_id = res["id"]
    asyncio.run(podcasts.process(ep_id))  # the background task, run to completion here

    ep = client.get(f"/api/episodes/{ep_id}").json()
    assert ep["status"] == "ready" and ep["source"] == "podcast" and ep["segmented_by"] == "whisper"
    assert [s["text"] for s in ep["sentences"]] == ["Hi there, welcome back.", "Today we order coffee like a pro."]
    assert ep["sentences"][1]["start"] == pytest.approx(WORDS[4].start, abs=0.01)  # Whisper word times are used directly
    assert client.get("/api/podcasts/feed", params={"url": "https://feed.test/rss"}).json()["episodes"][0]["episode_id"] == ep_id
    assert client.post("/api/podcasts/import", json={"feed_url": "https://feed.test/rss", "guid": "ep-2"}).json()["id"] == ep_id

    media_res = client.get(f"/api/media/{ep_id}", headers={"Range": "bytes=0-2"})
    assert media_res.status_code == 206 and media_res.content == b"ID3"

    client.delete(f"/api/episodes/{ep_id}")
    assert not list(media.AUDIO_DIR.glob(f"{ep_id}.*"))


def test_podcast_failure_is_retryable(client, monkeypatch):
    monkeypatch.setattr(media, "whisper_status", lambda: (False, "本机跑不了 Whisper"))
    with app.db.connect() as conn:
        ep = add_episode(conn, "podcast:abc", source="podcast", audio_url="https://cdn.test/a.mp3", status="processing")
    asyncio.run(podcasts.process(ep))
    detail = client.get(f"/api/episodes/{ep}").json()
    assert detail["status"] == "failed" and "Whisper" in detail["status_detail"]

    assert client.post(f"/api/episodes/{ep}/retry").status_code == 200
    asyncio.run(podcasts.process(ep))  # still no Whisper: fails again, stays retryable
    with app.db.connect() as conn:
        conn.execute("UPDATE episodes SET status = 'ready' WHERE id = ?", (ep,))
    assert client.post(f"/api/episodes/{ep}/retry").status_code == 400  # ready episodes keep their history

    with app.db.connect() as conn:
        conn.execute("UPDATE episodes SET status = 'processing' WHERE id = ?", (ep,))
    podcasts.recover_interrupted()
    assert "重启" in client.get(f"/api/episodes/{ep}").json()["status_detail"]


def test_whisper_tokens_are_rejoined():
    seg = {"words": [{"word": w, "start": i, "end": i + 0.5} for i, w in enumerate(
        [" This", " is", " an", " all", "-ears", " English", " episode", " 27", "-09", ".", " It", "'s", " $250", " don", "'t", " site", ".com"])]}
    words = media.whisper_words([seg])
    assert " ".join(w.text for w in words) == "This is an all-ears English episode 27-09. It's $250 don't site.com"
    assert words[3].start == 3 and words[3].end == 4.5  # "all-ears" spans both tokens

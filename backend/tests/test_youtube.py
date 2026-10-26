"""yt-dlp captions with word times, retiming caption words, channel listings and the YouTube audio job."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
import app.media as media
import app.youtube as youtube
import app.youtube_extras as extras
from app.segment import Word, build_words, retime, retime_sentences, segment_by_rules, timed_words, transcript_words
from app.youtube import Snippet, Transcript

# What YouTube's json3 looks like: automatic captions time every word as an offset from its line's start.
AUTO_JSON3 = {
    "events": [
        {"tStartMs": 0, "dDurationMs": 5000, "segs": [{"utf8": "so"}, {"utf8": " in", "tOffsetMs": 300},
                                                       {"utf8": " college", "tOffsetMs": 500}]},
        {"tStartMs": 4000, "dDurationMs": 10, "aAppend": 1, "segs": [{"utf8": "\n"}]},
        {"tStartMs": 4000, "dDurationMs": 6000, "segs": [{"utf8": "I"}, {"utf8": " was", "tOffsetMs": 200},
                                                          {"utf8": " [Music]", "tOffsetMs": 400}]},
    ]
}
MANUAL_JSON3 = {
    "events": [
        {"tStartMs": 100, "dDurationMs": 1500, "segs": [{"utf8": "So in college,"}]},
        {"tStartMs": 3500, "dDurationMs": 2000, "segs": [{"utf8": "I was..."}]},
        {"tStartMs": 9000, "dDurationMs": 1000},
    ]
}


def test_caption_words_use_offsets_and_cap_word_length():
    words = youtube.caption_words(AUTO_JSON3)
    assert [(w.text, w.start, w.line) for w in words] == [
        ("so", 0.0, 0), ("in", 0.3, 0), ("college", 0.5, 0), ("I", 4.0, 2), ("was", 4.2, 2), ("[Music]", 4.4, 2)
    ]
    assert words[0].duration == pytest.approx(0.3)  # ends when the next word starts
    assert words[2].duration == pytest.approx(0.3 + 0.08 * 7)  # a pause follows: capped, not stretched to 4.0
    assert youtube.caption_words(MANUAL_JSON3) is None  # human-made captions have no word times
    assert [(s.text, s.start) for s in youtube.caption_lines(MANUAL_JSON3)] == [("So in college,", 0.1), ("I was...", 3.5)]


def test_track_prefers_original_language_and_skips_translations():
    tracks = {
        "en": [{"ext": "vtt", "url": "u1"}, {"ext": "json3", "url": "https://x/timedtext?lang=de&tlang=en"}],
        "en-orig": [{"ext": "json3", "url": "https://x/timedtext?lang=en"}],
    }
    assert youtube._track(tracks, ["en-orig", "en"]) == "https://x/timedtext?lang=en"
    assert youtube._track({"en": tracks["en"]}, ["en-orig", "en"]) is None


def test_generated_captions_use_their_word_times():
    t = Transcript(youtube.caption_lines(AUTO_JSON3), is_generated=True, words=youtube.caption_words(AUTO_JSON3))
    words = transcript_words(t)
    assert [w.text for w in words] == ["so", "in", "college", "I", "was"]  # [Music] cleaned out
    assert words[3].start == 4.0 and words[3].snippet == 2


def test_manual_captions_move_onto_recognized_times():
    manual = [Snippet("So in college, I was a government major,", 10.0, 4.0), Snippet("which means papers.", 14.0, 2.0)]
    asr = [Snippet(w, t, 0.3) for w, t in
           [("so", 11.0), ("in", 11.2), ("college", 11.4), ("I", 12.6), ("was", 12.8), ("a", 12.9),
            ("government", 13.0), ("major", 13.6), ("which", 14.4), ("means", 14.6), ("papers", 15.0)]]
    words = transcript_words(Transcript(manual, is_generated=False, words=asr))
    assert [w.text for w in words][:3] == ["So", "in", "college,"]  # the human-made text is kept
    assert [w.start for w in words] == [11.0, 11.2, 11.4, 12.6, 12.8, 12.9, 13.0, 13.6, 14.4, 14.6, 15.0]
    sentences, _ = segment_by_rules(words)
    assert sentences[0].start == 11.0


def test_retime_keeps_caption_timing_where_recognition_heard_nothing():
    # Captions: "now here's my brain. (laughter) There is a difference." The recognizer missed the middle part.
    captions = build_words([Snippet("Now here's my brain.", 220.0, 2.0), Snippet("There is a difference.", 235.0, 2.0),
                            Snippet("Both brains", 238.0, 1.0)])
    timed = [Word("now", 220.5, 220.8, 0), Word("both", 238.5, 238.8, 0), Word("brains", 238.8, 239.2, 0)]
    out = retime(captions, timed)
    there = out[4]
    assert there.text == "There" and 234 < there.start < 237  # not squeezed toward the "now" at 220
    assert [w.start for w in out] == sorted(w.start for w in out)


def test_retime_ignores_matches_that_go_back_in_time():
    captions = build_words([Snippet("you know you know it", 0.0, 2.0)])
    timed = [Word("you", 0.1, 0.2, 0), Word("know", 0.2, 0.4, 0), Word("you", 5.0, 5.2, 0), Word("know", 5.2, 5.4, 0),
             Word("it", 5.5, 5.6, 0)]
    out = retime(captions, timed)
    assert [w.start for w in out] == sorted(w.start for w in out)
    assert out[-1].start == 5.5


def test_retime_sentences_keeps_text_and_moves_times():
    sentences = [(10.0, 12.0, "Hi there, welcome back."), (12.0, 15.0, "Today we order coffee.")]
    timed = [Word(t, 11.0 + i * 0.4, 11.3 + i * 0.4, 0) for i, t in
             enumerate("Hi there, welcome back. Today we order coffee.".split())]
    assert retime_sentences(sentences, timed) == [(11.0, 12.5), (12.6, 14.1)]


class FakeYDL:
    """Stands in for yt_dlp.YoutubeDL."""

    def __init__(self, info=None, files=None, error=None):
        self.info, self.files, self.error = info, files or {}, error

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download=False, process=True):
        if self.error:
            raise self.error
        return self.info

    def urlopen(self, url):
        body = json.dumps(self.files[url]).encode()
        return type("Resp", (), {"read": lambda self: body})()


def test_fetch_video_with_ytdlp(monkeypatch):
    info = {
        "title": "T", "channel": "C", "channel_url": "https://www.youtube.com/channel/UCx",
        "subtitles": {"en-GB": [{"ext": "json3", "url": "manual"}]},
        "automatic_captions": {"en-orig": [{"ext": "json3", "url": "auto"}]},
    }
    monkeypatch.setattr(youtube, "_ydl", lambda **o: FakeYDL(info, {"manual": MANUAL_JSON3, "auto": AUTO_JSON3}))
    video = youtube.fetch_video("arj7oStGLkU")
    assert (video.title, video.channel, video.channel_url, video.note) == ("T", "C", "https://www.youtube.com/channel/UCx", None)
    assert not video.transcript.is_generated and video.transcript.snippets[0].text == "So in college,"
    assert len(video.transcript.words) == 6

    monkeypatch.setattr(youtube, "_ydl", lambda **o: FakeYDL({**info, "subtitles": {}, "automatic_captions": {}}))
    with pytest.raises(youtube.TranscriptError, match="没有英文字幕"):
        youtube.fetch_video("arj7oStGLkU")


def test_fetch_video_falls_back_when_ytdlp_breaks(monkeypatch):
    monkeypatch.setattr(youtube, "_ydl", lambda **o: FakeYDL(error=RuntimeError("ERROR: [youtube] arj7oStGLkU: nsig extraction failed")))
    monkeypatch.setattr(youtube, "fetch_metadata", lambda vid: ("Old way", "Chan"))
    monkeypatch.setattr(youtube, "fetch_transcript", lambda vid: Transcript([Snippet("Hello there.", 0, 1)], is_generated=False))
    video = youtube.fetch_video("arj7oStGLkU")
    assert video.title == "Old way" and video.transcript.words is None
    assert "nsig extraction failed" in video.note and "yt-dlp" in video.note


def test_channel_videos(monkeypatch):
    info = {
        "channel": "TED", "channel_url": "https://www.youtube.com/channel/UCx", "title": "TED - Videos",
        "thumbnails": [{"url": "banner", "width": 1060, "height": 175}, {"url": "avatar", "width": 900, "height": 900}],
        "entries": [{"id": "cTHwSER_l-8", "title": "A talk", "duration": 546, "view_count": 3}, {"id": "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"}],
    }
    monkeypatch.setattr(youtube, "_ydl", lambda **o: FakeYDL(info))
    data = youtube.channel_videos("https://www.youtube.com/@TED/featured")
    assert data == {"title": "TED", "url": "https://www.youtube.com/channel/UCx", "image": "avatar",
                    "videos": [{"video_id": "cTHwSER_l-8", "title": "A talk", "duration": 546, "views": 3}]}
    with pytest.raises(youtube.TranscriptError):
        youtube.channel_videos("https://example.com/nope")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(media, "AUDIO_DIR", tmp_path / "audio")
    with TestClient(app.main.app) as c:
        yield c


def add_video(conn, video_id="arj7oStGLkU", channel="TED", segmented_by="punctuation"):
    ep = conn.execute(
        "INSERT INTO episodes (video_id, title, channel, caption_kind, segmented_by) VALUES (?, 'T', ?, 'manual', ?)",
        (video_id, channel, segmented_by),
    ).lastrowid
    conn.executemany(
        "INSERT INTO sentences (episode_id, idx, clip_idx, start_s, end_s, text) VALUES (?, ?, 0, ?, ?, ?)",
        [(ep, 0, 10.0, 12.0, "Hi there, welcome back."), (ep, 1, 12.0, 15.0, "Today we order coffee.")],
    )
    return ep


def test_import_stores_channel_and_passes_on_notes(client, monkeypatch):
    video = youtube.Video("T", "C", "https://www.youtube.com/channel/UCx",
                          Transcript([Snippet("Hello there, my friend.", 0, 2)], is_generated=False), note="估算的")
    monkeypatch.setattr(app.main, "fetch_video", lambda vid: video)
    ep = client.post("/api/episodes", json={"url": "arj7oStGLkU"}).json()
    assert ep["channel_url"] == "https://www.youtube.com/channel/UCx" and ep["warning"] == "估算的"
    assert ep["has_audio"] is False and ep["audio_status"] == ""


def test_channel_endpoint_marks_imported_and_remembers_channel(client, monkeypatch):
    with app.db.connect() as conn:
        ep = add_video(conn)
        add_video(conn, "dQw4w9WgXcQ")
    listing = {"title": "TED", "url": "https://www.youtube.com/channel/UCx", "image": None,
               "videos": [{"video_id": "arj7oStGLkU", "title": "A", "duration": 1, "views": 1},
                          {"video_id": "cTHwSER_l-8", "title": "B", "duration": 1, "views": 1}]}
    monkeypatch.setattr(youtube, "channel_videos", lambda url: {**listing, "videos": [dict(v) for v in listing["videos"]]})
    data = client.get("/api/youtube/channel", params={"url": "https://www.youtube.com/watch?v=arj7oStGLkU"}).json()
    assert [v["episode_id"] for v in data["videos"]] == [ep, None]
    episodes = client.get("/api/episodes").json()
    assert {e["channel_url"] for e in episodes} == {"https://www.youtube.com/channel/UCx"}  # the whole show learned it

    def fail(url):
        raise youtube.TranscriptError("找不到")

    monkeypatch.setattr(youtube, "channel_videos", fail)
    assert client.get("/api/youtube/channel", params={"url": "x"}).status_code == 400


WHISPER = [Word(t, 11.0 + i * 0.4, 11.3 + i * 0.4, 0) for i, t in
           enumerate("Hi there, welcome back. Today we order coffee.".split())]


def fake_download(video_id, folder, stem, on_progress):
    on_progress(50)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{stem}.m4a"
    path.write_bytes(b"fake-m4a")
    return path


def test_audio_job_retimes_sentences_and_keeps_history(client, monkeypatch):
    monkeypatch.setattr(youtube, "download_audio", fake_download)
    monkeypatch.setattr(media, "whisper_status", lambda: (True, ""))
    monkeypatch.setattr(media, "transcribe", lambda path: WHISPER)
    with app.db.connect() as conn:
        ep = add_video(conn)
        conn.execute("INSERT INTO attempts (sentence_id, kind, user_text, score) VALUES (1, 'dictation', 'hi', 1)")
    assert client.post(f"/api/episodes/{ep}/audio").status_code == 200
    asyncio.run(extras.process(ep))  # the background task, run to completion here

    detail = client.get(f"/api/episodes/{ep}").json()
    assert detail["audio_status"] == "ready" and "对齐" in detail["audio_detail"] and detail["has_audio"] is True
    assert [(s["id"], s["start"], s["end"]) for s in detail["sentences"]] == [(1, 11.0, 12.5), (2, 12.6, 14.1)]
    assert detail["sentences"][0]["dictation_score"] == 1  # practice history is still attached
    assert client.get(f"/api/media/{ep}").content == b"fake-m4a"
    assert client.get("/api/episodes").json()[0]["has_audio"] is True


def test_rough_cuts_without_history_get_whisper_sentences(client, monkeypatch):
    monkeypatch.setattr(youtube, "download_audio", fake_download)
    monkeypatch.setattr(media, "whisper_status", lambda: (True, ""))
    monkeypatch.setattr(media, "transcribe", lambda path: WHISPER)
    with app.db.connect() as conn:
        ep = add_video(conn, segmented_by="fallback")
    asyncio.run(extras.process(ep))
    detail = client.get(f"/api/episodes/{ep}").json()
    assert detail["segmented_by"] == "whisper" and detail["caption_kind"] == "whisper"
    assert [s["text"] for s in detail["sentences"]] == ["Hi there, welcome back.", "Today we order coffee."]


def test_audio_job_without_whisper_or_with_errors(client, monkeypatch):
    monkeypatch.setattr(youtube, "download_audio", fake_download)
    monkeypatch.setattr(media, "whisper_status", lambda: (False, "需要 Apple Silicon"))
    with app.db.connect() as conn:
        ep = add_video(conn)
    asyncio.run(extras.process(ep))
    detail = client.get(f"/api/episodes/{ep}").json()
    assert detail["audio_status"] == "ready" and "Apple Silicon" in detail["audio_detail"]
    assert detail["sentences"][0]["start"] == 10.0  # not retimed, but the audio is there

    def broken(*args):
        raise youtube.TranscriptError("YouTube 要求验证")

    monkeypatch.setattr(youtube, "download_audio", broken)
    with app.db.connect() as conn:
        other = add_video(conn, "dQw4w9WgXcQ")
    asyncio.run(extras.process(other))
    assert client.get(f"/api/episodes/{other}").json()["audio_status"] == "failed"

    with app.db.connect() as conn:
        conn.execute("UPDATE episodes SET audio_status = 'processing' WHERE id = ?", (other,))
    extras.recover_interrupted()
    assert "重启" in client.get(f"/api/episodes/{other}").json()["audio_detail"]
    with app.db.connect() as conn:
        conn.execute("UPDATE episodes SET source = 'podcast' WHERE id = ?", (other,))
    assert client.post(f"/api/episodes/{other}/audio").status_code == 400


def test_partial_downloads_are_not_served(client):
    media.AUDIO_DIR.mkdir(parents=True)
    (media.AUDIO_DIR / "7.m4a.part").write_bytes(b"half")
    assert app.podcasts.audio_path(7) is None
    (media.AUDIO_DIR / "7.m4a").write_bytes(b"whole")
    assert app.podcasts.audio_path(7).name == "7.m4a"


def test_timed_words_split_on_whitespace():
    assert [(w.text, w.snippet) for w in timed_words([Snippet("[Music]", 0, 1), Snippet(" well", 1.0, 0.3, line=4)])] == [("well", 4)]

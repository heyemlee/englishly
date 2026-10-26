"""Video preparation publishes complete MP4 files and serves seekable, authenticated byte ranges."""

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
import app.video
import app.youtube
from helpers import add_sentence, save_chunk


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(app.video, "_lock", asyncio.Lock())
    monkeypatch.setattr(app.video, "_tasks", {})
    monkeypatch.delenv("PODECHO_MODE", raising=False)
    monkeypatch.delenv("PODECHO_PASSWORD", raising=False)
    with TestClient(app.main.app) as c:
        yield c


def test_video_file_supports_seek_ranges_and_login(client, monkeypatch):
    add_sentence()
    path = app.video.video_path(1)
    path.parent.mkdir()
    path.write_bytes(b"0123456789")
    response = client.get("/api/video/1", headers={"Range": "bytes=2-5"})
    assert response.status_code == 206 and response.content == b"2345"
    assert response.headers["content-range"] == "bytes 2-5/10"
    assert response.headers["content-type"] == "video/mp4"
    assert client.get("/api/episodes/1").json()["has_video"] is True
    monkeypatch.setenv("PODECHO_PASSWORD", "test-password")
    assert client.get("/api/video/1").status_code == 401
    assert client.get("/api/video/1", headers={"Authorization": "Bearer test-password"}).status_code == 200


def test_missing_or_ineligible_video_never_starts_download(client, monkeypatch):
    assert client.get("/api/video/999").status_code == 404
    assert client.post("/api/episodes/999/video").status_code == 404
    add_sentence()
    assert client.get("/api/video/1").status_code == 404
    with app.db.connect() as conn:
        conn.execute("UPDATE episodes SET source = 'podcast' WHERE id = 1")
    assert client.post("/api/episodes/1/video").status_code == 400
    monkeypatch.setenv("PODECHO_MODE", "cloud")
    assert client.post("/api/episodes/1/video").status_code == 403


def test_prepare_existing_file_and_deleting_episode(client, monkeypatch):
    add_sentence()
    path = app.video.video_path(1)
    path.parent.mkdir()
    path.write_bytes(b"video")
    def unexpected(*args):
        raise AssertionError("existing files are never downloaded again")
    monkeypatch.setattr(app.youtube, "download_video", unexpected)
    assert client.post("/api/episodes/1/video").status_code == 200
    assert client.get("/api/episodes/1").json()["video_status"] == "ready"
    assert client.delete("/api/episodes/1").status_code == 200
    assert not path.exists()


def test_preparing_video_preserves_subtitles_and_reviews(client, monkeypatch):
    chunk = save_chunk(client)
    with app.db.connect() as conn:
        conn.execute("UPDATE sentences SET translation_zh = '他们会把工作分摊开。'")
        before = {table: [tuple(r) for r in conn.execute(f"SELECT * FROM {table} ORDER BY id")]
                  for table in ("sentences", "cards", "saved_chunks")}
    def download(video_id, folder, stem, progress):
        assert video_id == "arj7oStGLkU"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{stem}.mp4"
        progress(50)
        path.write_bytes(b"completed")
        return path
    monkeypatch.setattr(app.youtube, "download_video", download)
    asyncio.run(app.video.process(1))
    assert client.get("/api/episodes/1").json()["video_status"] == "ready"
    with app.db.connect() as conn:
        for table, rows in before.items():
            assert [tuple(r) for r in conn.execute(f"SELECT * FROM {table} ORDER BY id")] == rows
    assert client.get("/api/chunks").json()[0]["id"] == chunk["id"]


def test_failed_preparation_is_retryable_and_restart_marks_interruption(client, monkeypatch):
    add_sentence()
    def failed(*args):
        raise app.youtube.TranscriptError("网络暂时不可用")
    monkeypatch.setattr(app.youtube, "download_video", failed)
    asyncio.run(app.video.process(1))
    state = client.get("/api/episodes/1").json()
    assert state["video_status"] == "failed" and "网络" in state["video_detail"]
    app.video.status(1, "processing")
    app.video.recover_interrupted()
    assert client.get("/api/episodes/1").json()["video_status"] == "failed"


def test_download_publishes_only_merged_mp4(tmp_path, monkeypatch):
    folder = tmp_path / "video"
    options = {}
    class Downloader:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def extract_info(self, url, download):
            assert download and url.endswith("arj7oStGLkU")
            assert not (folder / "1.mp4").exists()
            options["progress_hooks"][0]({"status": "downloading", "downloaded_bytes": 2, "total_bytes": 4})
            Path(options["outtmpl"].replace("%(ext)s", "mp4")).write_bytes(b"merged-video")
    def ydl(**kwargs):
        options.update(kwargs)
        return Downloader()
    monkeypatch.setattr(app.youtube, "_ydl", ydl)
    progress = []
    result = app.youtube.download_video("arj7oStGLkU", folder, "1", progress.append)
    assert result.read_bytes() == b"merged-video" and progress == [50]
    assert list(folder.iterdir()) == [result]
    assert "avc1" in options["format"] and "height<=720" in options["format"]


def test_partial_download_is_not_published(tmp_path, monkeypatch):
    class Downloader:
        def __init__(self, options): self.options = options
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def extract_info(self, *args, **kwargs):
            Path(self.options["outtmpl"].replace("%(ext)s", "mp4.part")).write_bytes(b"partial")
            raise RuntimeError("download interrupted")
    monkeypatch.setattr(app.youtube, "_ydl", lambda **options: Downloader(options))
    folder = tmp_path / "video"
    with pytest.raises(app.youtube.TranscriptError):
        app.youtube.download_video("arj7oStGLkU", folder, "1", lambda _: None)
    assert not list(folder.iterdir())


def test_listening_elsewhere_plays_the_mp4_instead_of_youtube(client):
    """Review listen cards, notebook replay and the mishear drill play /api/media: without downloaded audio, the MP4."""
    save_chunk(client)
    assert client.get("/api/media/1").status_code == 404
    path = app.video.video_path(1)
    path.parent.mkdir()
    path.write_bytes(b"0123456789")
    app.video.status(1, "ready")
    sound = client.get("/api/media/1", headers={"Range": "bytes=0-3"})
    assert sound.status_code == 206 and sound.content == b"0123"
    assert client.get("/api/chunks").json()[0]["has_audio"] is True
    client.put("/api/review/kinds", json={"kinds": ["listen"]})
    assert client.get("/api/review").json()["card"]["listen"]["audio"] is True
    client.post("/api/attempts", json={"sentence_id": 1, "kind": "dictation", "user_text": "x", "score": 0.5,
                                       "details": {"missed": ["work"]}})
    assert client.get("/api/mishears/practice").json()["items"][0]["has_audio"] is True
    assert client.get("/api/episodes/1").json()["has_audio"] is False  # the practice page still shows the video


def test_polling_reads_only_the_job_fields(client):
    add_sentence()
    app.video.status(1, "processing", "准备视频 40%")
    assert client.get("/api/episodes/1/status").json() == {
        "status": "ready", "status_detail": "", "audio_status": "", "audio_detail": "",
        "video_status": "processing", "video_detail": "准备视频 40%"}
    assert client.get("/api/episodes/999/status").status_code == 404

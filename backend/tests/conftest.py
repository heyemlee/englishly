import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))  # lets tests import helpers.py

import app.media  # noqa: E402
import app.podcasts  # noqa: E402
import app.youtube_extras  # noqa: E402


@pytest.fixture(autouse=True)
def no_background_jobs(monkeypatch):
    """Endpoints would start Whisper jobs in the test client's event loop, where one can be left holding the shared
    Whisper lock when the test ends; tests run `process()` themselves instead, each with a fresh lock."""
    monkeypatch.setattr(app.podcasts, "start", lambda episode_id: None)
    monkeypatch.setattr(app.youtube_extras, "start", lambda episode_id: app.youtube_extras._status(episode_id, "processing", "排队中…"))
    monkeypatch.setattr(app.media, "WHISPER_LOCK", asyncio.Lock())


@pytest.fixture(autouse=True)
def no_mlx(monkeypatch):
    """Importing mlx aborts the whole process where there's no Metal GPU (sandboxes, CI); tests that need Whisper
    fake it themselves."""
    monkeypatch.setattr(app.media, "whisper_status", lambda: (False, "tests don't load mlx"))

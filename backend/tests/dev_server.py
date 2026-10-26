"""Run the API on separate test data, to click through the app without touching your real data.

    cd backend && .venv/bin/python tests/dev_server.py

Serves on port 8812, next to the real one on 8811 (PORT=... for another one), but keeps everything in data/fake/ (database,
downloaded audio) and uses the small Whisper model (whisper-tiny, ~75 MB) unless WHISPER_MODEL says otherwise.
"""

import os
import sys
from pathlib import Path

os.environ.setdefault("WHISPER_MODEL", "mlx-community/whisper-tiny")  # before app.media reads it

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import uvicorn  # noqa: E402

import app.db  # noqa: E402
import app.main  # noqa: E402
import app.media  # noqa: E402

FAKE_DATA = BACKEND / "data" / "fake"
app.db.DB_PATH = FAKE_DATA / "fake.db"
app.media.AUDIO_DIR = FAKE_DATA / "audio"

if __name__ == "__main__":
    uvicorn.run(app.main.app, port=int(os.getenv("PORT", "8812")))

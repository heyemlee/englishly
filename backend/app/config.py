import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "data" / "app.db")))

# Each practice clip is roughly this long.
CLIP_SECONDS = float(os.getenv("CLIP_SECONDS", "180"))

# New review cards introduced per day; due reviews are never capped.
NEW_CARDS_PER_DAY = int(os.getenv("NEW_CARDS_PER_DAY", "20"))

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3030,http://127.0.0.1:3030").split(",")

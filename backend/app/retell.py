"""4/3/2 retelling: say the same content three times under shrinking time limits, and compare the rounds."""

import json
import sqlite3

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from .db import connect, loads

router = APIRouter(prefix="/api")


class Round(BaseModel):
    limit_seconds: float = Field(gt=0)
    total_seconds: float = Field(ge=0)
    speaking_seconds: float | None = Field(default=None, ge=0)
    transcript: str = ""
    words: int = Field(ge=0)
    wpm: float = Field(ge=0)
    pauses: int = Field(ge=0)
    longest_pause: float = Field(default=0, ge=0)


class RetellIn(BaseModel):
    episode_id: int | None = None
    clip_idx: int | None = None
    topic: str = Field(default="", max_length=300)
    rounds: list[Round] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def has_subject(self):
        if self.episode_id is None and not self.topic.strip():
            raise ValueError("retell needs a clip or a topic")
        return self


def payload(row: sqlite3.Row, title: str | None = None) -> dict:
    return {
        "id": row["id"],
        "episode_id": row["episode_id"],
        "clip_idx": row["clip_idx"],
        "topic": row["topic"],
        "title": title,
        "rounds": loads(row["rounds"]),
        "created_at": row["created_at"],
    }


def _load(conn: sqlite3.Connection, retell_id: int) -> dict:
    row = conn.execute(
        "SELECT r.*, e.title FROM retells r LEFT JOIN episodes e ON e.id = r.episode_id WHERE r.id = ?", (retell_id,)
    ).fetchone()
    return payload(row, row["title"])


@router.get("/retells")
def list_retells():
    with connect() as conn:
        rows = conn.execute(
            """SELECT r.*, e.title FROM retells r LEFT JOIN episodes e ON e.id = r.episode_id
                ORDER BY r.id DESC LIMIT 30"""
        ).fetchall()
    return [payload(r, r["title"]) for r in rows]


@router.post("/retells")
def save_retell(body: RetellIn):
    with connect() as conn:
        if body.episode_id is not None and not conn.execute(
            "SELECT 1 FROM episodes WHERE id = ?", (body.episode_id,)
        ).fetchone():
            raise HTTPException(404, "找不到这个视频。")
        cur = conn.execute(
            "INSERT INTO retells (episode_id, clip_idx, topic, rounds) VALUES (?, ?, ?, ?)",
            (
                body.episode_id,
                body.clip_idx,
                body.topic.strip(),
                json.dumps([r.model_dump() for r in body.rounds], ensure_ascii=False),
            ),
        )
        return _load(conn, cur.lastrowid)

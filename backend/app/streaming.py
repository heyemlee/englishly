"""Companion for the user's signed-in Netflix/Hulu player. Never fetches video, cookies or licences."""

import json
import re
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from .db import connect
from .learning import StudyIn

router = APIRouter(prefix="/api/streaming")
Provider = Literal["netflix", "hulu"]
MAX_TIME = 172800


def canonical_url(provider: str, media_id: str) -> str:
    pattern = r"[0-9]{1,20}" if provider == "netflix" else r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    if not re.fullmatch(pattern, media_id):
        raise HTTPException(422, "没有认出这个节目的编号。")
    host = "www.netflix.com" if provider == "netflix" else "www.hulu.com"
    return f"https://{host}/watch/{media_id}"


class CueIn(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    start: float = Field(ge=0, le=MAX_TIME, allow_inf_nan=False)
    end: float = Field(gt=0, le=MAX_TIME, allow_inf_nan=False)
    text: str = Field(min_length=1, max_length=5000)
    timing: Literal["exact", "observed"]

    @model_validator(mode="after")
    def interval(self):
        if self.end <= self.start or not self.text.strip():
            raise ValueError("字幕文字或时间范围不对。")
        return self


class OfficialSubtitleIn(CueIn):
    track_id: str = Field(min_length=1, max_length=180)
    language: Literal["zh", "zh-Hans", "zh-Hant"]
    label: str = Field(max_length=200)
    timing: Literal["exact"] = "exact"


class SnapshotIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    position: float = Field(ge=0, le=MAX_TIME, allow_inf_nan=False)
    duration: float = Field(default=0, ge=0, le=MAX_TIME, allow_inf_nan=False)
    cues: list[CueIn] = Field(default_factory=list, max_length=250)
    official_subtitles: list[OfficialSubtitleIn] = Field(default_factory=list, max_length=250)


def session_row(conn, provider, media_id):
    canonical_url(provider, media_id)
    row = conn.execute("SELECT * FROM streaming_sessions WHERE provider = ? AND media_id = ?",
                       (provider, media_id)).fetchone()
    if not row:
        raise HTTPException(404, "还没有这个节目的学习记录。")
    return row


@router.get("")
def recent_sessions():
    with connect() as conn:
        return [dict(r) for r in conn.execute(
            """SELECT x.*, (SELECT COUNT(*) FROM streaming_cues c WHERE c.session_id = x.id) AS cue_count
               FROM streaming_sessions x ORDER BY x.updated_at DESC, x.id DESC LIMIT 30""")]


@router.get("/{provider}/{media_id}")
def detail(provider: Provider, media_id: str):
    with connect() as conn:
        row = session_row(conn, provider, media_id)
        cues = [{**dict(c), "key": c["cue_key"], "clip": int(c["start"] // 180),
                 "annotations": json.loads(c["annotations"])} for c in conn.execute(
                     "SELECT * FROM streaming_cues WHERE session_id = ? ORDER BY start, id", (row["id"],))]
        lessons = [dict(r) for r in conn.execute(
            "SELECT clip, title, summary, goal FROM streaming_lessons WHERE session_id = ? ORDER BY clip", (row["id"],))]
        official = [{**dict(r), "key": r["cue_key"], "timing": "exact"} for r in conn.execute(
            "SELECT * FROM streaming_official_subtitles WHERE session_id = ? ORDER BY start, id", (row["id"],))]
        return {**dict(row), "sentences": cues, "lessons": lessons, "official_subtitles": official}


@router.put("/{provider}/{media_id}")
def save_snapshot(provider: Provider, media_id: str, body: SnapshotIn):
    url = canonical_url(provider, media_id)
    if not body.title.strip():
        raise HTTPException(400, "请填写节目标题。")
    if len({c.key for c in body.cues}) != len(body.cues):
        raise HTTPException(400, "字幕编号不能重复。")
    if len({(c.track_id, c.key) for c in body.official_subtitles}) != len(body.official_subtitles):
        raise HTTPException(400, "官方字幕编号不能重复。")
    with connect() as conn:
        conn.execute(
            """INSERT INTO streaming_sessions (provider, media_id, title, url, position, duration) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(provider, media_id) DO UPDATE SET title = excluded.title, position = excluded.position,
               duration = MAX(streaming_sessions.duration, excluded.duration), updated_at = datetime('now')""",
            (provider, media_id, body.title.strip(), url, body.position, body.duration))
        row = session_row(conn, provider, media_id)
        for c in body.cues:
            old = conn.execute("SELECT text, start FROM streaming_cues WHERE session_id = ? AND cue_key = ?",
                               (row["id"], c.key)).fetchone()
            if old and (old["text"] != c.text or abs(old["start"] - c.start) > 0.001):
                raise HTTPException(409, "字幕编号已用于不同原文，请重新读取后保存。")
            conn.execute(
                """INSERT INTO streaming_cues (session_id, cue_key, start, end, text, timing) VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(session_id, cue_key) DO UPDATE SET end = excluded.end""",
                (row["id"], c.key, c.start, c.end, c.text, c.timing))
        for c in body.official_subtitles:
            old = conn.execute(
                "SELECT text, start FROM streaming_official_subtitles WHERE session_id = ? AND track_id = ? AND cue_key = ?",
                (row["id"], c.track_id, c.key)).fetchone()
            if old and (old["text"] != c.text or abs(old["start"] - c.start) > .001):
                raise HTTPException(409, "官方字幕编号已用于不同原文。")
            conn.execute(
                """INSERT INTO streaming_official_subtitles (session_id, track_id, language, label, cue_key, start, end, text)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, track_id, cue_key)
                   DO UPDATE SET end=excluded.end, label=excluded.label""",
                (row["id"], c.track_id, c.language, c.label, c.key, c.start, c.end, c.text))
    return {"ok": True, "id": row["id"], "saved": len(body.cues)}


@router.put("/{provider}/{media_id}/study")
def study(provider: Provider, media_id: str, body: StudyIn):
    """Same payload/offset rules as episode study; only captured/imported subtitles are available here."""
    with connect() as conn:
        row = session_row(conn, provider, media_id)
        seen = set()
        for item in body.sentences:
            if item.sentence_id in seen:
                raise HTTPException(400, "同一个句子不能重复提交。")
            seen.add(item.sentence_id)
            cue = conn.execute("SELECT * FROM streaming_cues WHERE id = ? AND session_id = ?",
                               (item.sentence_id, row["id"])).fetchone()
            if not cue:
                raise HTTPException(404, "提交的句子不属于这个节目。")
            if cue["text"] != item.text:
                raise HTTPException(409, "字幕已变化，请重新读取原句再处理。")
            end = -1
            for a in sorted(item.annotations or [], key=lambda a: a.start):
                if a.end <= a.start or a.end > len(item.text) or item.text[a.start:a.end] != a.text:
                    raise HTTPException(400, "重点标注的位置与原文不一致。")
                if a.start < end:
                    raise HTTPException(400, "同一句中的重点标注不能重叠。")
                if not a.meaning_zh.strip():
                    raise HTTPException(400, "请提供重点表达的语境释义。")
                end = a.end
            if "translation_zh" in item.model_fields_set:
                conn.execute("UPDATE streaming_cues SET translation_zh = ? WHERE id = ?",
                             ((item.translation_zh or "").strip() or None, cue["id"]))
            if item.annotations is not None:
                conn.execute("UPDATE streaming_cues SET annotations = ? WHERE id = ?",
                             (json.dumps([a.model_dump() for a in item.annotations], ensure_ascii=False), cue["id"]))
        clips = set()
        for clip in body.clips:
            if clip.clip in clips:
                raise HTTPException(400, "同一个片段不能重复提交。")
            clips.add(clip.clip)
            if not conn.execute("SELECT 1 FROM streaming_cues WHERE session_id = ? AND start >= ? AND start < ?",
                                (row["id"], clip.clip * 180, (clip.clip + 1) * 180)).fetchone():
                raise HTTPException(404, "找不到这个片段。")
            conn.execute(
                """INSERT INTO streaming_lessons (session_id, clip, title, summary, goal) VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(session_id, clip) DO UPDATE SET title=excluded.title, summary=excluded.summary, goal=excluded.goal""",
                (row["id"], clip.clip, clip.title.strip(), clip.summary.strip(), clip.goal.strip()))
    return {"ok": True, "sentences_updated": len(body.sentences), "clips_updated": len(body.clips)}


@router.delete("/{provider}/{media_id}")
def delete_session(provider: Provider, media_id: str):
    canonical_url(provider, media_id)
    with connect() as conn:
        conn.execute("DELETE FROM streaming_sessions WHERE provider = ? AND media_id = ?", (provider, media_id))
    return {"ok": True}

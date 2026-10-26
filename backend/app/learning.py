"""Locally supplied study material and actual listening activity. No model credentials or external inference."""

import json
import math
import sqlite3
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .db import connect

router = APIRouter(prefix="/api")


class AnnotationIn(BaseModel):
    kind: Literal["word", "phrase", "expression"]
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=200)
    meaning_zh: str = Field(min_length=1, max_length=200)
    usage_zh: str = Field(default="", max_length=2000)
    example_en: str = Field(default="", max_length=1000)
    example_zh: str = Field(default="", max_length=1000)


class SentenceStudyIn(BaseModel):
    sentence_id: int
    text: str  # Original text is an optimistic check against re-segmentation or stale exports.
    translation_zh: str | None = Field(default=None, max_length=5000)
    annotations: list[AnnotationIn] | None = Field(default=None, max_length=60)


class ClipLessonIn(BaseModel):
    clip: int = Field(ge=0)
    title: str = Field(default="", max_length=200)
    summary: str = Field(default="", max_length=2000)
    goal: str = Field(default="", max_length=1000)


class StudyIn(BaseModel):
    sentences: list[SentenceStudyIn] = Field(default_factory=list, max_length=5000)
    clips: list[ClipLessonIn] = Field(default_factory=list, max_length=1000)


@router.put("/episodes/{episode_id}/study")
def supply_study_material(episode_id: int, body: StudyIn):
    """Apply a batch atomically. Only explicitly supplied translations/annotations are replaced.

    Annotation offsets count Unicode code points, start inclusive / end exclusive.
    The assistant can prepare this payload from GET /api/episodes/{episode_id}.
    """
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM episodes WHERE id = ?", (episode_id,)).fetchone():
            raise HTTPException(404, "找不到这个节目。")
        seen: set[int] = set()
        for item in body.sentences:
            if item.sentence_id in seen:
                raise HTTPException(400, "同一个句子不能重复提交。")
            seen.add(item.sentence_id)
            row = conn.execute("SELECT text FROM sentences WHERE id = ? AND episode_id = ?",
                               (item.sentence_id, episode_id)).fetchone()
            if not row:
                raise HTTPException(404, "提交的句子不属于这个节目。")
            if row["text"] != item.text:
                raise HTTPException(409, "字幕已变化，请重新读取原句再处理。")
            previous_end = -1
            for annotation in sorted(item.annotations or [], key=lambda a: a.start):
                if (annotation.end <= annotation.start or annotation.end > len(item.text)
                        or item.text[annotation.start:annotation.end] != annotation.text):
                    raise HTTPException(400, "重点标注的位置与原文不一致。")
                if annotation.start < previous_end:
                    raise HTTPException(400, "同一句中的重点标注不能重叠。")
                if not annotation.meaning_zh.strip():
                    raise HTTPException(400, "请提供重点表达的语境释义。")
                previous_end = annotation.end
            if "translation_zh" in item.model_fields_set:
                conn.execute("UPDATE sentences SET translation_zh = ? WHERE id = ?",
                             ((item.translation_zh or "").strip() or None, item.sentence_id))
            if item.annotations is not None:
                conn.execute("DELETE FROM sentence_annotations WHERE sentence_id = ?", (item.sentence_id,))
                conn.executemany(
                    """INSERT INTO sentence_annotations
                       (sentence_id, kind, start_offset, end_offset, text, meaning_zh, usage_zh, example_en, example_zh)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [(item.sentence_id, a.kind, a.start, a.end, a.text, a.meaning_zh.strip(),
                      a.usage_zh.strip(), a.example_en.strip(), a.example_zh.strip()) for a in item.annotations],
                )
        seen_clips: set[int] = set()
        for clip in body.clips:
            if clip.clip in seen_clips:
                raise HTTPException(400, "同一个片段不能重复提交。")
            seen_clips.add(clip.clip)
            if not conn.execute("SELECT 1 FROM sentences WHERE episode_id = ? AND clip_idx = ?",
                                (episode_id, clip.clip)).fetchone():
                raise HTTPException(404, "找不到这个片段。")
            conn.execute(
                """INSERT INTO clip_lessons (episode_id, clip_idx, title, summary, goal) VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(episode_id, clip_idx) DO UPDATE SET
                   title = excluded.title, summary = excluded.summary, goal = excluded.goal""",
                (episode_id, clip.clip, clip.title.strip(), clip.summary.strip(), clip.goal.strip()),
            )
    return {"ok": True, "sentences_updated": len(body.sentences), "clips_updated": len(body.clips)}


def annotations_for(conn: sqlite3.Connection, episode_id: int) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = {}
    for row in conn.execute(
        """SELECT a.* FROM sentence_annotations a JOIN sentences s ON s.id = a.sentence_id
           WHERE s.episode_id = ? ORDER BY a.start_offset""", (episode_id,),
    ):
        item = dict(row)
        item["start"] = item.pop("start_offset")
        item["end"] = item.pop("end_offset")
        out.setdefault(row["sentence_id"], []).append(item)
    return out


def progress_for(conn: sqlite3.Connection, episode_id: int) -> dict:
    row = conn.execute(
        """SELECT COUNT(CASE WHEN l.heard = 1 THEN 1 END) AS heard_count,
                  COUNT(CASE WHEN l.heard = 1 OR EXISTS (SELECT 1 FROM attempts a WHERE a.sentence_id = s.id)
                             THEN 1 END) AS studied_count,
                  COALESCE(SUM(l.seconds), 0) AS listening_seconds
           FROM sentences s LEFT JOIN sentence_listening l ON l.sentence_id = s.id WHERE s.episode_id = ?""",
        (episode_id,),
    ).fetchone()
    position = conn.execute(
        """SELECT s.idx FROM episode_progress p JOIN sentences s ON s.id = p.sentence_id
           WHERE p.episode_id = ?""", (episode_id,),
    ).fetchone()
    last = conn.execute(
        """SELECT MAX(t) FROM (
            SELECT MAX(a.created_at) t FROM attempts a JOIN sentences s ON s.id = a.sentence_id WHERE s.episode_id = ?
            UNION ALL SELECT MAX(l.updated_at) FROM sentence_listening l JOIN sentences s ON s.id = l.sentence_id
            WHERE s.episode_id = ?)""", (episode_id, episode_id),
    ).fetchone()[0]
    return {**dict(row), "last_sentence_idx": position["idx"] if position else None, "last_activity_at": last}


class PositionIn(BaseModel):
    sentence_id: int


@router.put("/episodes/{episode_id}/position")
def save_position(episode_id: int, body: PositionIn):
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM sentences WHERE id = ? AND episode_id = ?",
                            (body.sentence_id, episode_id)).fetchone():
            raise HTTPException(404, "找不到这个句子。")
        conn.execute(
            """INSERT INTO episode_progress (episode_id, sentence_id) VALUES (?, ?)
               ON CONFLICT(episode_id) DO UPDATE SET sentence_id = excluded.sentence_id, updated_at = datetime('now')""",
            (episode_id, body.sentence_id),
        )
    return {"ok": True}


class ListeningEventIn(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    sentence_id: int
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(gt=0, allow_inf_nan=False)
    seconds: float = Field(gt=0, le=30, allow_inf_nan=False)


class ListeningIn(BaseModel):
    events: list[ListeningEventIn] = Field(max_length=100)


def merged_ranges(ranges: list[list[float]]) -> list[list[float]]:
    merged: list[list[float]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + 0.05:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


@router.post("/episodes/{episode_id}/listening")
def record_listening(episode_id: int, body: ListeningIn):
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM episodes WHERE id = ?", (episode_id,)).fetchone():
            raise HTTPException(404, "找不到这个节目。")
        for event in body.events:
            sentence = conn.execute("SELECT start_s, end_s FROM sentences WHERE id = ? AND episode_id = ?",
                                    (event.sentence_id, episode_id)).fetchone()
            if not sentence:
                raise HTTPException(404, "提交的句子不属于这个节目。")
            if (event.end <= event.start or event.start < sentence["start_s"] - 0.05
                    or event.end > sentence["end_s"] + 0.05 or event.end - event.start > 30):
                raise HTTPException(400, "收听区间超出句子范围。")
            existing = conn.execute("SELECT sentence_id, start_s, end_s, seconds FROM listening_events WHERE id = ?", (event.id,)).fetchone()
            if existing:
                if (existing["sentence_id"] != event.sentence_id or not math.isclose(existing["seconds"], event.seconds)
                        or not math.isclose(existing["start_s"], event.start) or not math.isclose(existing["end_s"], event.end)):
                    raise HTTPException(409, "收听记录编号已被其他记录使用。")
                continue  # retries do not inflate listening time
            conn.execute("INSERT INTO listening_events (id, sentence_id, start_s, end_s, seconds) VALUES (?, ?, ?, ?, ?)",
                         (event.id, event.sentence_id, event.start, event.end, event.seconds))
            old = conn.execute("SELECT ranges FROM sentence_listening WHERE sentence_id = ?", (event.sentence_id,)).fetchone()
            ranges = merged_ranges((json.loads(old["ranges"]) if old else []) + [[event.start, event.end]])
            heard = sum(b - a for a, b in ranges) >= (sentence["end_s"] - sentence["start_s"]) * 0.8
            conn.execute(
                """INSERT INTO sentence_listening (sentence_id, ranges, heard, seconds) VALUES (?, ?, ?, ?)
                   ON CONFLICT(sentence_id) DO UPDATE SET ranges = excluded.ranges,
                   heard = MAX(sentence_listening.heard, excluded.heard),
                   seconds = sentence_listening.seconds + excluded.seconds, updated_at = datetime('now')""",
                (event.sentence_id, json.dumps(ranges), int(heard), event.seconds),
            )
        progress = progress_for(conn, episode_id)
    return progress


@router.get("/mishears/practice")
def mishear_practice(word: str = "", limit: int = Query(default=10, ge=1, le=30)):
    from .stats import norm

    with connect() as conn:
        rows = conn.execute(
            """SELECT a.score, a.details, s.id AS sentence_id, s.idx AS sentence_idx, s.text, s.start_s, s.end_s,
                      e.id AS episode_id, e.title, e.source, e.video_id,
                      (e.source = 'podcast' OR e.audio_status = 'ready' OR e.video_status = 'ready') AS has_audio  -- /api/media plays it
               FROM attempts a JOIN sentences s ON s.id = a.sentence_id JOIN episodes e ON e.id = s.episode_id
               WHERE a.kind = 'dictation' AND e.status = 'ready'
                 AND a.id = (SELECT MAX(a2.id) FROM attempts a2 WHERE a2.sentence_id = s.id AND a2.kind = 'dictation')
                 AND a.score < 1 ORDER BY a.score, a.id DESC LIMIT 1000"""
        ).fetchall()
    items = []
    for row in rows:
        details = json.loads(row["details"] or "{}")
        missed = details.get("missed", [])
        wrong = details.get("wrong", [])
        errors = [w for w in missed if isinstance(w, str)]
        errors += [x.get("expected", "") for x in wrong if isinstance(x, dict)]
        if not errors or (word and norm(word) not in {norm(w) for error in errors for w in error.split()}):
            continue
        item = dict(row)
        item.pop("details")
        item["has_audio"] = bool(item["has_audio"])
        item["before_score"] = item.pop("score")
        items.append(item)
        if len(items) == limit:
            break
    return {"items": items}

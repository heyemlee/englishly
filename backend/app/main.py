import asyncio
import json
import sqlite3
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import auth, learning, media, pages, podcasts, retell, review, stats, streaming, video, youtube_extras
from .auth import local_only
from .config import CLIP_SECONDS, CORS_ORIGINS
from .db import connect, init_db
from .segment import assign_clips, segment_by_rules, transcript_words
from .youtube import TranscriptError, fetch_video, parse_video_id


@asynccontextmanager
async def lifespan(_: FastAPI):
    before = init_db()
    if before < 2:
        review.backfill_chunk_cards()
    if before < 5:
        review.backfill_card_kinds()
    podcasts.recover_interrupted()
    youtube_extras.recover_interrupted()
    video.recover_interrupted()
    yield


app = FastAPI(title="Podcast English Practice", lifespan=lifespan)
# The web app reaches the API through the Next.js rewrite; CORS only matters when calling it directly from a page.
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
# Pages, scripts and JSON shrink to about a third (matters on a phone over mobile data); audio, video and byte ranges
# are left alone.
app.add_middleware(GZipMiddleware, minimum_size=1024)
for module in (auth, review, retell, stats, podcasts, youtube_extras, learning, video, streaming):
    app.include_router(module.router)


@app.middleware("http")
async def require_login(request: Request, call_next):
    """With PODECHO_PASSWORD set (a public server), the API needs logging in first; see auth.py."""
    path = request.url.path
    if path.startswith("/api/") and path not in auth.OPEN_PATHS and not auth.authorized(request):
        return JSONResponse({"detail": "请先登录。"}, status_code=401)
    return await call_next(request)


class ImportRequest(BaseModel):
    url: str


class TimingPatch(BaseModel):
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, ge=0)


class AttemptIn(BaseModel):
    sentence_id: int
    kind: Literal["dictation", "shadow"]
    user_text: str
    score: float = Field(ge=0, le=1)
    details: dict | None = None


class StarIn(BaseModel):
    starred: bool


class ChunkIn(BaseModel):
    """An expression the learner picked out of a sentence, with its meaning in their own words."""

    sentence_id: int
    pattern: str = Field(min_length=1, max_length=200)
    meaning_zh: str = Field(min_length=1, max_length=200)


@app.get("/api/health")
def health():
    whisper_ok, whisper_why = media.whisper_status()
    return {
        "ok": True,
        "cloud": auth.cloud(),  # the web app hides importing on a cloud server
        "login": bool(auth.password()),
        "whisper": {"available": whisper_ok, "reason": whisper_why, "model": media.WHISPER_MODEL},
    }


@app.get("/api/episodes")
def list_episodes():
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT e.*,
                   COUNT(s.id)                AS sentence_count,
                   COALESCE(MAX(s.clip_idx), -1) + 1 AS clip_count,
                   COALESCE(MAX(s.end_s), 0)  AS duration,
                   (SELECT COUNT(DISTINCT a.sentence_id) FROM attempts a
                      JOIN sentences s2 ON s2.id = a.sentence_id
                     WHERE s2.episode_id = e.id) AS practiced_count,
                   (SELECT MAX(a.created_at) FROM attempts a
                      JOIN sentences s2 ON s2.id = a.sentence_id
                     WHERE s2.episode_id = e.id) AS last_practiced_at,
                   (e.source = 'podcast' OR e.audio_status = 'ready') AS has_audio
              FROM episodes e
              LEFT JOIN sentences s ON s.episode_id = e.id
             GROUP BY e.id
             ORDER BY e.id DESC
            """
        ).fetchall()
        return [{**dict(r), "has_audio": bool(r["has_audio"]), **learning.progress_for(conn, r["id"])} for r in rows]


@app.post("/api/episodes", dependencies=[Depends(local_only)])
async def import_episode(body: ImportRequest):
    try:
        video_id = parse_video_id(body.url)
    except TranscriptError as e:
        raise HTTPException(400, str(e))

    with connect() as conn:
        existing = conn.execute("SELECT id FROM episodes WHERE video_id = ?", (video_id,)).fetchone()
        if existing:
            return episode_detail(conn, existing["id"])

    try:
        video = await asyncio.to_thread(fetch_video, video_id)
    except TranscriptError as e:
        raise HTTPException(400, str(e))
    transcript = video.transcript

    words = transcript_words(transcript)
    if not words:
        raise HTTPException(400, "字幕是空的，换一个视频试试。")

    sentences, method = segment_by_rules(words)
    warning = None
    if method == "fallback":
        warning = "这个视频的自动字幕没有标点，句子是按长度粗切的。开始练之前点「下载音频」，Whisper 会按标点重新切。"

    clips = assign_clips(sentences, CLIP_SECONDS)
    with connect() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO episodes (video_id, title, channel, channel_url, caption_kind, segmented_by)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (video_id, video.title, video.channel, video.channel_url,
                 "generated" if transcript.is_generated else "manual", method),
            )
        except sqlite3.IntegrityError:  # imported concurrently by another request
            existing = conn.execute("SELECT id FROM episodes WHERE video_id = ?", (video_id,)).fetchone()
            return episode_detail(conn, existing["id"])
        episode_id = cur.lastrowid
        conn.executemany(
            "INSERT INTO sentences (episode_id, idx, clip_idx, start_s, end_s, text) VALUES (?, ?, ?, ?, ?, ?)",
            [(episode_id, i, c, s.start, s.end, s.text) for i, (s, c) in enumerate(zip(sentences, clips))],
        )
        detail = episode_detail(conn, episode_id)
    detail["warning"] = " ".join(filter(None, [warning, video.note])) or None
    return detail


@app.get("/api/episodes/by-video/{video_id}")
def get_episode_by_video(video_id: str):
    """For the Chrome extension: the imported episode for a YouTube video, if any."""
    with connect() as conn:
        row = conn.execute("SELECT id FROM episodes WHERE video_id = ?", (video_id,)).fetchone()
        if not row:
            raise HTTPException(404, "这个视频还没导入。")
        return episode_detail(conn, row["id"])


@app.get("/api/episodes/{episode_id}")
def get_episode(episode_id: int):
    with connect() as conn:
        return episode_detail(conn, episode_id)


@app.get("/api/episodes/{episode_id}/status")
def get_episode_status(episode_id: int):
    """What the background jobs are doing (transcribing, audio, video), for polling without reloading every sentence."""
    with connect() as conn:
        row = conn.execute(
            """SELECT status, status_detail, audio_status, audio_detail, video_status, video_detail
                 FROM episodes WHERE id = ?""", (episode_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "找不到这个视频。")
    return dict(row)


@app.put("/api/episodes/{episode_id}/star")
def star_episode(episode_id: int, body: StarIn):
    """Star an episode for the 学习记录 page's 已收藏 list. Starring again keeps the original time."""
    with connect() as conn:
        if body.starred:
            cur = conn.execute(
                "UPDATE episodes SET starred_at = COALESCE(starred_at, datetime('now')) WHERE id = ?", (episode_id,)
            )
        else:
            cur = conn.execute("UPDATE episodes SET starred_at = NULL WHERE id = ?", (episode_id,))
        if not cur.rowcount:
            raise HTTPException(404, "找不到这个视频。")
        row = conn.execute("SELECT starred_at FROM episodes WHERE id = ?", (episode_id,)).fetchone()
    return {"starred_at": row["starred_at"]}


@app.delete("/api/episodes/{episode_id}")
def delete_episode(episode_id: int):
    with connect() as conn:
        conn.execute("DELETE FROM episodes WHERE id = ?", (episode_id,))
    podcasts.remove_files(episode_id)
    video.video_path(episode_id).unlink(missing_ok=True)
    return {"ok": True}


@app.patch("/api/sentences/{sentence_id}")
def update_timing(sentence_id: int, body: TimingPatch):
    with connect() as conn:
        row = conn.execute("SELECT start_s, end_s FROM sentences WHERE id = ?", (sentence_id,)).fetchone()
        if not row:
            raise HTTPException(404, "找不到这个句子。")
        start = row["start_s"] if body.start is None else round(body.start, 2)
        end = row["end_s"] if body.end is None else round(body.end, 2)
        if end - start < 0.3:
            raise HTTPException(400, "句子结束时间要比开始时间晚。")
        conn.execute("UPDATE sentences SET start_s = ?, end_s = ? WHERE id = ?", (start, end, sentence_id))
    return {"id": sentence_id, "start": start, "end": end}


@app.post("/api/attempts")
def create_attempt(body: AttemptIn):
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM sentences WHERE id = ?", (body.sentence_id,)).fetchone():
            raise HTTPException(404, "找不到这个句子。")
        cur = conn.execute(
            "INSERT INTO attempts (sentence_id, kind, user_text, score, details) VALUES (?, ?, ?, ?, ?)",
            (
                body.sentence_id,
                body.kind,
                body.user_text,
                body.score,
                json.dumps(body.details, ensure_ascii=False) if body.details else None,
            ),
        )
    return {"id": cur.lastrowid}


@app.get("/api/chunks")
def list_chunks():
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT c.*, s.text AS sentence_text, s.idx AS sentence_idx, s.start_s, s.end_s,
                   e.id AS episode_id, e.video_id, e.title AS episode_title, e.source,
                   (e.source = 'podcast' OR e.audio_status = 'ready' OR e.video_status = 'ready') AS has_audio,  -- /api/media plays it
                   EXISTS(SELECT 1 FROM cards WHERE chunk_id = c.id) AS in_review
              FROM saved_chunks c
              LEFT JOIN sentences s ON s.id = c.sentence_id
              LEFT JOIN episodes e ON e.id = s.episode_id
             ORDER BY c.id DESC
            """
        ).fetchall()
    return [{**dict(r), "has_audio": bool(r["has_audio"]), "in_review": bool(r["in_review"]),
             "review_pending": bool(r["review_pending"])} for r in rows]


@app.post("/api/chunks")
def save_chunk(body: ChunkIn):
    pattern, meaning = " ".join(body.pattern.split()), body.meaning_zh.strip()
    if not pattern or not meaning:
        raise HTTPException(400, "请填写英文和中文意思。")
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM sentences WHERE id = ?", (body.sentence_id,)).fetchone():
            raise HTTPException(404, "找不到这个句子。")
        conn.execute(
            """INSERT INTO saved_chunks (sentence_id, pattern, meaning_zh) VALUES (?, ?, ?)
               ON CONFLICT (pattern, sentence_id) DO UPDATE SET meaning_zh = excluded.meaning_zh""",
            (body.sentence_id, pattern, meaning),
        )
        row = conn.execute(
            "SELECT * FROM saved_chunks WHERE pattern = ? AND sentence_id = ?", (pattern, body.sentence_id)
        ).fetchone()
        review.add_chunk_card(conn, row)  # saving a chunk also puts it into review
        try:
            conn.execute("UPDATE cards SET prompt_zh = ? WHERE chunk_id = ?", (meaning, row["id"]))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "已有相同释义的复习卡，请换一个更贴合原句的释义。")
    return {"id": row["id"], "pattern": row["pattern"], "meaning_zh": row["meaning_zh"]}


class ManualChunkIn(BaseModel):
    pattern: str = Field(min_length=1, max_length=200)
    meaning_zh: str = Field(default="", max_length=200)  # may come later (Codex fills it in via PATCH)
    context_en: str = Field(default="", max_length=1000)
    context_zh: str = Field(default="", max_length=1000)
    source_label: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=2000)
    add_to_review: bool = True


def enroll_chunk(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    """Make cards once; enrolling an existing entry never resets its schedule."""
    # Cards have a global uniqueness rule. Do not silently attach another entry's card.
    other = conn.execute(
        """SELECT 1 FROM cards WHERE kind = 'produce' AND prompt_zh = ? AND answer_en = ?
           AND (chunk_id IS NULL OR chunk_id != ?)""", (row["meaning_zh"], row["pattern"], row["id"]),
    ).fetchone()
    if other:
        raise HTTPException(409, "已有相同英文和释义的复习卡，可搜索查看，或补充释义后再加入复习。")
    review.add_chunk_card(conn, row)
    sentence = conn.execute("SELECT text FROM sentences WHERE id = ?", (row["sentence_id"],)).fetchone()
    context = sentence["text"] if sentence else row["context_en"]
    expected = 2 + int(bool(context and review.cloze_blanks(context, row["pattern"])))
    count = conn.execute("SELECT COUNT(*) FROM cards WHERE chunk_id = ?", (row["id"],)).fetchone()[0]
    if count < expected:
        raise HTTPException(409, "这条例句和释义已有对应的复习卡，请补充更具体的释义后重试。")


def enroll_or_wait(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    """Join review now, or, without a meaning to prompt with yet, as soon as one is filled in."""
    if row["meaning_zh"]:
        enroll_chunk(conn, row)
    conn.execute("UPDATE saved_chunks SET review_pending = ? WHERE id = ?", (int(not row["meaning_zh"]), row["id"]))


def chunk_state(conn: sqlite3.Connection, chunk_id: int) -> dict:
    row = conn.execute(
        """SELECT id, pattern, meaning_zh, context_en, context_zh, review_pending,
                  EXISTS(SELECT 1 FROM cards WHERE chunk_id = saved_chunks.id) AS in_review
             FROM saved_chunks WHERE id = ?""", (chunk_id,),
    ).fetchone()
    return {**dict(row), "review_pending": bool(row["review_pending"]), "in_review": bool(row["in_review"])}


@app.post("/api/chunks/manual")
def create_manual_chunk(body: ManualChunkIn):
    pattern, meaning = " ".join(body.pattern.split()), body.meaning_zh.strip()
    if not pattern:
        raise HTTPException(400, "请填写英文。")
    with connect() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO saved_chunks
                   (pattern, meaning_zh, entry_source, context_en, context_zh, source_label, notes)
                   VALUES (?, ?, 'manual', ?, ?, ?, ?)""",
                (pattern, meaning, body.context_en.strip(), body.context_zh.strip(),
                 body.source_label.strip(), body.notes.strip()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "单词本中已有相同的英文和释义，请搜索查看。" if meaning else "单词本里已经有这个词了，请搜索查看。")
        row = conn.execute("SELECT * FROM saved_chunks WHERE id = ?", (cur.lastrowid,)).fetchone()
        if body.add_to_review:
            enroll_or_wait(conn, row)
        return chunk_state(conn, row["id"])


@app.post("/api/chunks/{chunk_id}/review")
def enroll_saved_chunk(chunk_id: int):
    with connect() as conn:
        row = conn.execute("SELECT * FROM saved_chunks WHERE id = ?", (chunk_id,)).fetchone()
        if not row:
            raise HTTPException(404, "找不到这个词条。")
        enroll_or_wait(conn, row)
        return {"ok": True, **chunk_state(conn, chunk_id)}


@app.delete("/api/chunks/{chunk_id}")
def delete_chunk(chunk_id: int):
    with connect() as conn:
        conn.execute("DELETE FROM saved_chunks WHERE id = ?", (chunk_id,))
    return {"ok": True}


class ChunkPatch(BaseModel):
    """Correct an entry, or fill in a word added on its own. Fields left out keep their value."""

    meaning_zh: str | None = Field(default=None, max_length=200)
    context_en: str | None = Field(default=None, max_length=1000)
    context_zh: str | None = Field(default=None, max_length=1000)


@app.patch("/api/chunks/{chunk_id}")
def update_chunk(chunk_id: int, body: ChunkPatch):
    fields = {k: v.strip() for k, v in body.model_dump().items() if v is not None}
    if fields.get("meaning_zh") == "":
        raise HTTPException(400, "请填写中文意思。")
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM saved_chunks WHERE id = ?", (chunk_id,)).fetchone():
            raise HTTPException(404, "找不到这个语块。")
        try:
            if fields:
                conn.execute(f"UPDATE saved_chunks SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                             (*fields.values(), chunk_id))
            if "meaning_zh" in fields:
                # Edit content without resetting card IDs, FSRS schedules or review history.
                conn.execute("UPDATE cards SET prompt_zh = ? WHERE chunk_id = ?", (fields["meaning_zh"], chunk_id))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "已有相同英文和释义的词条或复习卡，请补充更具体的释义。")
        row = conn.execute("SELECT * FROM saved_chunks WHERE id = ?", (chunk_id,)).fetchone()
        if row["review_pending"] and row["meaning_zh"]:  # waiting for this meaning to join review
            enroll_or_wait(conn, row)
        return chunk_state(conn, chunk_id)


def episode_detail(conn: sqlite3.Connection, episode_id: int) -> dict:
    episode = conn.execute("SELECT * FROM episodes WHERE id = ?", (episode_id,)).fetchone()
    if not episode:
        raise HTTPException(404, "找不到这个视频。")
    rows = conn.execute(
        """
        SELECT s.*,
               (SELECT score FROM attempts a WHERE a.sentence_id = s.id AND a.kind = 'dictation'
                 ORDER BY a.id DESC LIMIT 1) AS dictation_score,
               (SELECT score FROM attempts a WHERE a.sentence_id = s.id AND a.kind = 'shadow'
                 ORDER BY a.id DESC LIMIT 1) AS shadow_score
          FROM sentences s
         WHERE s.episode_id = ?
         ORDER BY s.idx
        """,
        (episode_id,),
    ).fetchall()
    saved: dict[int, list[dict]] = {}
    for c in conn.execute(
        """SELECT c.id, c.sentence_id, c.pattern, c.meaning_zh FROM saved_chunks c
             JOIN sentences s ON s.id = c.sentence_id WHERE s.episode_id = ? ORDER BY c.id""",
        (episode_id,),
    ):
        saved.setdefault(c["sentence_id"], []).append({"id": c["id"], "pattern": c["pattern"], "meaning_zh": c["meaning_zh"]})

    annotations = learning.annotations_for(conn, episode_id)
    heard = {r["sentence_id"] for r in conn.execute(
        """SELECT l.sentence_id FROM sentence_listening l JOIN sentences s ON s.id = l.sentence_id
           WHERE s.episode_id = ? AND l.heard = 1""", (episode_id,),
    )}
    lessons = [dict(r) for r in conn.execute(
        "SELECT clip_idx AS clip, title, summary, goal FROM clip_lessons WHERE episode_id = ? ORDER BY clip_idx",
        (episode_id,),
    )]
    return {
        **dict(episode),
        **learning.progress_for(conn, episode_id),
        "lessons": lessons,
        "has_audio": episode["source"] == "podcast" or episode["audio_status"] == "ready",
        "has_video": video.video_path(episode_id).is_file(),
        "sentences": [
            {
                "id": r["id"],
                "idx": r["idx"],
                "clip": r["clip_idx"],
                "start": r["start_s"],
                "end": r["end_s"],
                "text": r["text"],
                "translation_zh": r["translation_zh"],
                "annotations": annotations.get(r["id"], []),
                "heard": r["id"] in heard,
                "dictation_score": r["dictation_score"],
                "shadow_score": r["shadow_score"],
                "saved": saved.get(r["id"], []),
            }
            for r in rows
        ],
    }


# Last, so every route above wins: the rest is the web app's built pages.
app.include_router(pages.router)

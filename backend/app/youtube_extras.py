"""YouTube beyond captions: a channel's videos (narrow listening) and a video's audio (precise, offline practice).

With the audio on disk, Whisper times every sentence precisely, playback works without the embedded player (offline,
on a locked phone, for videos that can't be embedded). Sentences keep their text and ids
and only their times move, so practice history and saved expressions stay attached.
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from . import media, podcasts, youtube
from .auth import local_only
from .config import CLIP_SECONDS
from .db import connect
from .segment import Word, assign_clips, retime_sentences, segment_by_rules

router = APIRouter(prefix="/api")

_tasks: set[asyncio.Task] = set()


@router.get("/youtube/channel", dependencies=[Depends(local_only)])
async def channel(url: str):
    """A channel's latest videos; `url` is the channel, or one of its videos when we don't know the channel yet."""
    url = url.strip()
    try:
        data = await asyncio.to_thread(youtube.channel_videos, url)
    except youtube.TranscriptError as e:
        raise HTTPException(400, str(e))
    with connect() as conn:
        if not youtube.is_channel_url(url):
            # Remember the channel for this video's show, so 「更多集」 opens it directly next time.
            conn.execute(
                """UPDATE episodes SET channel_url = ?
                    WHERE source = 'youtube' AND channel_url IS NULL
                      AND channel = (SELECT channel FROM episodes WHERE video_id = ?)""",
                (data["url"], youtube.parse_video_id(url)),
            )
        imported = {
            r["video_id"]: r["id"] for r in conn.execute("SELECT id, video_id FROM episodes WHERE source = 'youtube'")
        }
    for v in data["videos"]:
        v["episode_id"] = imported.get(v["video_id"])
    return data


def _status(episode_id: int, status: str, detail: str = "") -> None:
    with connect() as conn:
        conn.execute("UPDATE episodes SET audio_status = ?, audio_detail = ? WHERE id = ?", (status, detail, episode_id))


def apply_whisper(episode_id: int, timed: list[Word]) -> str:
    """Use Whisper's word times for the episode's sentences; returns what was done (for the status line)."""
    with connect() as conn:
        episode = conn.execute("SELECT segmented_by FROM episodes WHERE id = ?", (episode_id,)).fetchone()
        if episode is None:
            return ""
        rows = conn.execute(
            "SELECT id, start_s, end_s, text FROM sentences WHERE episode_id = ? ORDER BY idx", (episode_id,)
        ).fetchall()
        used = conn.execute(
            """SELECT EXISTS (SELECT 1 FROM sentences s WHERE s.episode_id = :ep AND (
                   s.translation_zh IS NOT NULL
                   OR EXISTS (SELECT 1 FROM sentence_annotations a WHERE a.sentence_id = s.id)
                   OR EXISTS (SELECT 1 FROM sentence_listening l WHERE l.sentence_id = s.id)
                   OR EXISTS (SELECT 1 FROM clip_lessons l WHERE l.episode_id = s.episode_id)
                   OR EXISTS (SELECT 1 FROM attempts a WHERE a.sentence_id = s.id)
                   OR EXISTS (SELECT 1 FROM saved_chunks c WHERE c.sentence_id = s.id)
                   OR EXISTS (SELECT 1 FROM cards c WHERE c.sentence_id = s.id)))""",
            {"ep": episode_id},
        ).fetchone()[0]
        if episode["segmented_by"] == "fallback" and not used:
            # Cut by length (auto captions without punctuation) and nothing done with them yet: take Whisper's
            # punctuated sentences instead.
            sentences, _ = segment_by_rules(timed)
            clips = assign_clips(sentences, CLIP_SECONDS)
            conn.execute("DELETE FROM sentences WHERE episode_id = ?", (episode_id,))
            conn.executemany(
                "INSERT INTO sentences (episode_id, idx, clip_idx, start_s, end_s, text) VALUES (?, ?, ?, ?, ?, ?)",
                [(episode_id, i, c, s.start, s.end, s.text) for i, (s, c) in enumerate(zip(sentences, clips))],
            )
            conn.execute(
                "UPDATE episodes SET segmented_by = 'whisper', caption_kind = 'whisper' WHERE id = ?", (episode_id,)
            )
            return "用 Whisper 的标点重新切了句子。"
        times = retime_sentences([(r["start_s"], r["end_s"], r["text"]) for r in rows], timed)
        conn.executemany(
            "UPDATE sentences SET start_s = ?, end_s = ? WHERE id = ?",
            [(start, end, r["id"]) for (start, end), r in zip(times, rows)],
        )
        return "句子时间已经按 Whisper 对齐。"


async def process(episode_id: int) -> None:
    _status(episode_id, "processing", "排队中…")
    async with media.WHISPER_LOCK:
        try:
            with connect() as conn:
                row = conn.execute("SELECT video_id FROM episodes WHERE id = ?", (episode_id,)).fetchone()
            if row is None:
                return  # deleted while queued
            path = podcasts.audio_path(episode_id)
            if path is None:
                _status(episode_id, "processing", "下载音频…")
                shown = [-10]

                def progress(percent: int) -> None:
                    if percent >= shown[0] + 10:
                        shown[0] = percent
                        _status(episode_id, "processing", f"下载音频 {percent}%")

                path = await asyncio.to_thread(
                    youtube.download_audio, row["video_id"], media.AUDIO_DIR, str(episode_id), progress
                )
            ok, why = media.whisper_status()
            if not ok:
                # The audio alone is still worth having: offline playback.
                _status(episode_id, "ready", f"音频下载好了，但句子时间没重新对齐：{why}")
                return
            _status(episode_id, "processing", f"Whisper 对齐句子时间（{media.WHISPER_MODEL}）。第一次用要先下载模型，可能要等几分钟。")
            timed = await asyncio.to_thread(media.transcribe, path)
            if not timed:
                raise media.MediaError("Whisper 没转写出内容，可能是纯音乐。")
            done = await asyncio.to_thread(apply_whisper, episode_id, timed)
            _status(episode_id, "ready", done)
        except (youtube.TranscriptError, media.MediaError) as e:
            _status(episode_id, "failed", str(e))
        except Exception as e:  # keep it retryable whatever went wrong
            _status(episode_id, "failed", f"处理失败：{type(e).__name__}: {e}")


def start(episode_id: int) -> None:
    _status(episode_id, "processing", "排队中…")
    task = asyncio.create_task(process(episode_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def recover_interrupted() -> None:
    """Jobs don't survive a backend restart; let the learner start them again."""
    with connect() as conn:
        conn.execute(
            "UPDATE episodes SET audio_status = 'failed', audio_detail = '后端重启，下载中断了，再点一次。' "
            "WHERE audio_status = 'processing'"
        )


@router.post("/episodes/{episode_id}/audio", dependencies=[Depends(local_only)])
async def download(episode_id: int):
    with connect() as conn:
        row = conn.execute("SELECT source, status, audio_status FROM episodes WHERE id = ?", (episode_id,)).fetchone()
    if not row:
        raise HTTPException(404, "找不到这个视频。")
    if row["source"] != "youtube" or row["status"] != "ready":
        raise HTTPException(400, "只有导入好的 YouTube 视频能下载音频。")
    if row["audio_status"] != "processing":
        start(episode_id)
    return {"ok": True}

"""Prepare plain video files for PodEcho's own player; subtitle/study data is never rewritten."""

import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from . import db, youtube
from .auth import local_only
from .db import connect

router = APIRouter(prefix="/api")
_tasks: dict[int, asyncio.Task] = {}
_lock = asyncio.Lock()  # keep large downloads sequential


def video_path(episode_id: int) -> Path:
    return db.DB_PATH.parent / "video" / f"{episode_id}.mp4"


def status(episode_id: int, state: str, detail: str = "") -> None:
    with connect() as conn:
        conn.execute("UPDATE episodes SET video_status = ?, video_detail = ? WHERE id = ?", (state, detail, episode_id))


async def process(episode_id: int) -> None:
    async with _lock:
        with connect() as conn:
            row = conn.execute("SELECT video_id FROM episodes WHERE id = ?", (episode_id,)).fetchone()
        if row is None:
            return
        try:
            status(episode_id, "processing", "准备视频…")
            shown = [-10]

            def progress(percent: int) -> None:
                if percent >= shown[0] + 10 or percent < shown[0]:
                    shown[0] = percent
                    status(episode_id, "processing", f"准备视频 {percent}%")

            path = video_path(episode_id)
            await asyncio.to_thread(youtube.download_video, row["video_id"], path.parent, str(episode_id), progress)
            with connect() as conn:
                current = conn.execute("SELECT video_id FROM episodes WHERE id = ?", (episode_id,)).fetchone()
            if current is None or current["video_id"] != row["video_id"]:
                path.unlink(missing_ok=True)
                return
            status(episode_id, "ready")
        except Exception as e:
            status(episode_id, "failed", str(e)[:400])


def recover_interrupted() -> None:
    with connect() as conn:
        conn.execute("""UPDATE episodes SET video_status = 'failed', video_detail = '视频准备中断了，请重试。'
                        WHERE video_status = 'processing'""")


@router.post("/episodes/{episode_id}/video", dependencies=[Depends(local_only)])
async def prepare(episode_id: int):
    with connect() as conn:
        row = conn.execute("SELECT source, status FROM episodes WHERE id = ?", (episode_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "找不到这个视频。")
    if row["source"] != "youtube" or row["status"] != "ready":
        raise HTTPException(400, "请先完成视频字幕导入。")
    if video_path(episode_id).is_file():
        status(episode_id, "ready")
    elif episode_id not in _tasks or _tasks[episode_id].done():
        status(episode_id, "processing", "排队准备视频…")
        task = asyncio.create_task(process(episode_id))
        _tasks[episode_id] = task
        task.add_done_callback(lambda finished: _tasks.pop(episode_id, None) if _tasks.get(episode_id) is finished else None)
    return {"ok": True}


@router.get("/video/{episode_id}")
def stream(episode_id: int):
    with connect() as conn:
        exists = conn.execute("SELECT 1 FROM episodes WHERE id = ?", (episode_id,)).fetchone()
    path = video_path(episode_id)
    if not exists or not path.is_file():
        raise HTTPException(404, "视频还没准备好。")
    return FileResponse(path, media_type="video/mp4")  # HTTP byte ranges allow scrubbing without downloading it again

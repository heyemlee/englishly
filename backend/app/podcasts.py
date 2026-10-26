"""Podcasts from RSS: find a show, pick an episode, download its audio and transcribe it with Whisper.

RSS audio is published for download, so unlike YouTube we keep a local copy: Whisper gets word-level timestamps
(precise sentence boundaries) and playback works offline.
"""

import asyncio
import hashlib
import html
import re
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx
from defusedxml import ElementTree
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import media
from .auth import local_only
from .config import CLIP_SECONDS
from .db import connect
from .segment import assign_clips, segment_by_rules
from .video import video_path

router = APIRouter(prefix="/api")

ITUNES_SEARCH = "https://itunes.apple.com/search"
ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
HEADERS = {"User-Agent": "PodEcho/0.3 (personal English practice app)"}

_tasks: set[asyncio.Task] = set()


class PodcastError(Exception):
    """Raised with a message that can be shown to the learner as-is."""


class ImportIn(BaseModel):
    feed_url: str = Field(min_length=1)
    guid: str = Field(min_length=1)


def source_key(feed_url: str, guid: str) -> str:
    return "podcast:" + hashlib.sha1(f"{feed_url}|{guid}".encode()).hexdigest()[:16]


def parse_duration(text: str | None) -> int | None:
    if not text:
        return None
    try:
        parts = [int(float(p)) for p in text.strip().split(":")]
    except ValueError:
        return None
    seconds = 0
    for p in parts:
        seconds = seconds * 60 + p
    return seconds


def _plain(text: str | None, limit: int = 200) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = " ".join(text.split())
    return text[:limit] + ("…" if len(text) > limit else "")


def parse_feed(xml: bytes, feed_url: str) -> dict:
    try:
        root = ElementTree.fromstring(xml)
    except Exception:
        raise PodcastError("读不懂这个地址的内容，确认是播客的 RSS 地址。")
    channel = root.find("channel")
    if channel is None:
        raise PodcastError("这不是播客的 RSS 地址。")
    image_el = channel.find(f"{ITUNES}image")
    image = (image_el.get("href") if image_el is not None else None) or channel.findtext("image/url")
    episodes = []
    for item in channel.findall("item"):
        enclosure = item.find("enclosure")
        url = enclosure.get("url") if enclosure is not None else None
        kind = (enclosure.get("type") or "") if enclosure is not None else ""
        if not url or (kind and not kind.startswith("audio")):
            continue
        published = None
        if item.findtext("pubDate"):
            try:
                published = parsedate_to_datetime(item.findtext("pubDate")).date().isoformat()
            except (TypeError, ValueError):
                pass
        item_image = item.find(f"{ITUNES}image")
        episodes.append(
            {
                "guid": (item.findtext("guid") or url).strip(),
                "title": (item.findtext("title") or "").strip() or "（无标题）",
                "published": published,
                "duration": parse_duration(item.findtext(f"{ITUNES}duration")),
                "audio_url": url,
                "image": (item_image.get("href") if item_image is not None else None) or image,
                "description": _plain(item.findtext("description") or item.findtext(f"{ITUNES}summary")),
            }
        )
        if len(episodes) >= 100:
            break
    return {
        "title": (channel.findtext("title") or "").strip(),
        "author": (channel.findtext(f"{ITUNES}author") or "").strip(),
        "image": image,
        "feed_url": feed_url,
        "episodes": episodes,
    }


async def fetch_feed(feed_url: str) -> dict:
    if urlparse(feed_url).scheme not in ("http", "https"):
        raise PodcastError("RSS 地址要以 http:// 或 https:// 开头。")
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20, headers=HEADERS) as client:
            res = await client.get(feed_url)
            res.raise_for_status()
    except httpx.HTTPError as e:
        raise PodcastError(f"打不开这个 RSS 地址：{e}")
    return parse_feed(res.content, feed_url)


def _status(episode_id: int, status: str, detail: str = "") -> None:
    with connect() as conn:
        conn.execute("UPDATE episodes SET status = ?, status_detail = ? WHERE id = ?", (status, detail, episode_id))


def audio_path(episode_id: int) -> Path | None:
    found = (p for p in sorted(media.AUDIO_DIR.glob(f"{episode_id}.*")) if p.suffix not in media.PARTIAL)
    return next(found, None)


def remove_files(episode_id: int) -> None:
    for path in media.AUDIO_DIR.glob(f"{episode_id}.*"):
        path.unlink(missing_ok=True)


async def _download(url: str, dest: Path, episode_id: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_suffix(dest.suffix + ".part")
    timeout = httpx.Timeout(30, read=120)
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout, headers=HEADERS) as client:
        async with client.stream("GET", url) as res:
            res.raise_for_status()
            total = int(res.headers.get("content-length") or 0)
            done, shown = 0, -10
            with open(partial, "wb") as f:
                async for chunk in res.aiter_bytes(1 << 16):
                    f.write(chunk)
                    done += len(chunk)
                    percent = done * 100 // total if total else None
                    if percent is not None and percent >= shown + 10:
                        shown = percent
                        _status(episode_id, "processing", f"下载音频 {percent}%")
    partial.rename(dest)


async def process(episode_id: int) -> None:
    _status(episode_id, "processing", "排队中…")
    async with media.WHISPER_LOCK:
        try:
            ok, why = media.whisper_status()
            if not ok:
                raise media.MediaError(why)
            with connect() as conn:
                row = conn.execute("SELECT audio_url FROM episodes WHERE id = ?", (episode_id,)).fetchone()
            if row is None:
                return  # deleted while queued
            path = audio_path(episode_id)
            if path is None:
                suffix = Path(urlparse(row["audio_url"]).path).suffix.lower()
                path = media.AUDIO_DIR / f"{episode_id}{suffix if suffix in {'.mp3', '.m4a', '.aac', '.ogg', '.wav'} else '.mp3'}"
                _status(episode_id, "processing", "下载音频…")
                await _download(row["audio_url"], path, episode_id)
            _status(
                episode_id,
                "processing",
                f"Whisper 转写中（{media.WHISPER_MODEL}）。第一次用要先下载模型，可能要等几分钟；一小时的节目一般几分钟转完。",
            )
            words = await asyncio.to_thread(media.transcribe, path)
            if not words:
                raise media.MediaError("没转写出内容，可能是纯音乐或者音频坏了。")
            sentences, _ = segment_by_rules(words)  # Whisper punctuates, and its word times are precise
            clips = assign_clips(sentences, CLIP_SECONDS)
            with connect() as conn:
                if not conn.execute("SELECT 1 FROM episodes WHERE id = ?", (episode_id,)).fetchone():
                    return
                conn.execute("DELETE FROM sentences WHERE episode_id = ?", (episode_id,))
                conn.executemany(
                    "INSERT INTO sentences (episode_id, idx, clip_idx, start_s, end_s, text) VALUES (?, ?, ?, ?, ?, ?)",
                    [(episode_id, i, c, s.start, s.end, s.text) for i, (s, c) in enumerate(zip(sentences, clips))],
                )
                conn.execute(
                    "UPDATE episodes SET status = 'ready', status_detail = '', segmented_by = 'whisper' WHERE id = ?",
                    (episode_id,),
                )
        except (media.MediaError, PodcastError) as e:
            _status(episode_id, "failed", str(e))
        except httpx.HTTPError as e:
            _status(episode_id, "failed", f"下载音频失败：{e}")
        except Exception as e:  # keep the episode retryable whatever went wrong
            _status(episode_id, "failed", f"处理失败：{type(e).__name__}: {e}")


def start(episode_id: int) -> None:
    task = asyncio.create_task(process(episode_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def recover_interrupted() -> None:
    """Jobs don't survive a backend restart; let the learner retry them."""
    with connect() as conn:
        conn.execute(
            "UPDATE episodes SET status = 'failed', status_detail = '后端重启，处理中断了，点「重试」。' WHERE status = 'processing'"
        )


@router.get("/podcasts/search", dependencies=[Depends(local_only)])
async def search(q: str):
    params = {"media": "podcast", "entity": "podcast", "term": q.strip(), "limit": 15}
    try:
        async with httpx.AsyncClient(timeout=15, headers=HEADERS) as client:
            res = await client.get(ITUNES_SEARCH, params=params)
            res.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(502, f"搜索失败：{e}")
    return [
        {
            "title": r.get("collectionName", ""),
            "author": r.get("artistName", ""),
            "feed_url": r["feedUrl"],
            "image": r.get("artworkUrl600") or r.get("artworkUrl100"),
            "episodes": r.get("trackCount"),
        }
        for r in res.json().get("results", [])
        if r.get("feedUrl")
    ]


@router.get("/podcasts/feed", dependencies=[Depends(local_only)])
async def feed(url: str):
    try:
        data = await fetch_feed(url.strip())
    except PodcastError as e:
        raise HTTPException(400, str(e))
    with connect() as conn:
        imported = {
            r["video_id"]: r["id"] for r in conn.execute("SELECT id, video_id FROM episodes WHERE source = 'podcast'")
        }
    for ep in data["episodes"]:
        ep["episode_id"] = imported.get(source_key(data["feed_url"], ep["guid"]))
    return data


@router.post("/podcasts/import", dependencies=[Depends(local_only)])
async def import_episode(body: ImportIn):
    key = source_key(body.feed_url, body.guid)
    with connect() as conn:
        existing = conn.execute("SELECT id FROM episodes WHERE video_id = ?", (key,)).fetchone()
    if existing:
        return {"id": existing["id"]}
    try:
        data = await fetch_feed(body.feed_url)
    except PodcastError as e:
        raise HTTPException(400, str(e))
    item = next((e for e in data["episodes"] if e["guid"] == body.guid), None)
    if item is None:
        raise HTTPException(404, "这一集在 RSS 里找不到了。")
    with connect() as conn:
        cur = conn.execute(
            """INSERT INTO episodes (video_id, title, channel, caption_kind, segmented_by, source, audio_url, image_url,
                                     feed_url, status, status_detail)
               VALUES (?, ?, ?, 'whisper', 'whisper', 'podcast', ?, ?, ?, 'processing', '排队中…')""",
            (key, item["title"], data["title"], item["audio_url"], item["image"], body.feed_url),
        )
        episode_id = cur.lastrowid
    start(episode_id)
    return {"id": episode_id}


@router.post("/episodes/{episode_id}/retry", dependencies=[Depends(local_only)])
async def retry(episode_id: int):
    with connect() as conn:
        row = conn.execute("SELECT source, status FROM episodes WHERE id = ?", (episode_id,)).fetchone()
    if not row:
        raise HTTPException(404, "找不到这个节目。")
    if row["source"] != "podcast" or row["status"] != "failed":
        # Re-transcribing a ready episode would replace its sentences and drop their practice history.
        raise HTTPException(400, "只有处理失败的播客节目可以重试。")
    start(episode_id)
    return {"ok": True}


@router.get("/media/{episode_id}")
def audio(episode_id: int):
    # Without downloaded audio the prepared MP4 does: an <audio> element plays its sound, so review cards, notebook
    # replay and the mishear drill don't have to load YouTube's player.
    path = audio_path(episode_id)
    if path is None and video_path(episode_id).is_file():
        path = video_path(episode_id)
    if path is None:
        raise HTTPException(404, "音频还没下载好。")
    return FileResponse(path)  # supports Range requests, so the player can seek

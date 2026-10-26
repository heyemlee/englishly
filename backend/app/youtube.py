"""YouTube: links, captions, channel listings and audio.

Captions come through yt-dlp, which also gets YouTube's automatic captions with a time for every word.
youtube-transcript-api is kept as a fallback for captions, for when YouTube changes something and yt-dlp needs an update.
"""

import json
import logging
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    CouldNotRetrieveTranscript,
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
)

log = logging.getLogger(__name__)

ENGLISH = ["en", "en-US", "en-GB", "en-CA", "en-AU"]
UPDATE_HINT = '如果一直这样，可能是 YouTube 改了接口，更新一下 yt-dlp：cd backend && uv pip install --python .venv/bin/python -U "yt-dlp[default]"'

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_CHANNEL_RE = re.compile(r"youtube\.com/(@[^/?#]+|channel/UC[\w-]{22}|c/[^/?#]+|user/[^/?#]+)", re.I)


class TranscriptError(Exception):
    """Raised with a message that can be shown to the learner as-is."""


@dataclass
class Snippet:
    text: str
    start: float
    duration: float
    line: int = 0  # for single words: the caption line they were shown in


@dataclass
class Transcript:
    snippets: list[Snippet]
    is_generated: bool
    # Single words timed by YouTube's speech recognition (from the automatic captions), when we could get them.
    words: list[Snippet] | None = None


@dataclass
class Video:
    title: str
    channel: str | None
    channel_url: str | None
    transcript: Transcript
    note: str | None = None  # something the learner should know about how the captions were fetched


def parse_video_id(url: str) -> str:
    url = url.strip()
    if _ID_RE.match(url):
        return url
    parsed = urllib.parse.urlparse(url if "://" in url else "https://" + url)
    host = parsed.netloc.lower().removeprefix("www.").removeprefix("m.")
    candidate = ""
    if host == "youtu.be":
        candidate = parsed.path.lstrip("/").split("/")[0]
    elif host.endswith("youtube.com"):
        if parsed.path == "/watch":
            candidate = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
        else:
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live", "v"}:
                candidate = parts[1]
    if not _ID_RE.match(candidate):
        raise TranscriptError("没认出这个链接，请贴 YouTube 视频地址，比如 https://www.youtube.com/watch?v=...")
    return candidate


class _Quiet:
    """yt-dlp prints errors even when quiet; they reach us as exceptions anyway."""

    def debug(self, msg: str) -> None:
        pass

    info = warning = debug

    def error(self, msg: str) -> None:
        log.debug("yt-dlp: %s", msg)


def _ydl(**options) -> yt_dlp.YoutubeDL:
    # YouTube's player needs a JavaScript runtime to give out media links; use whichever of Deno / Node.js is installed.
    runtimes = {name: {"path": path} for name in ("deno", "node") if (path := shutil.which(name))}
    return yt_dlp.YoutubeDL(
        {"logger": _Quiet(), "quiet": True, "no_warnings": True, "noprogress": True,
         "js_runtimes": runtimes or {"deno": {}}, **options}
    )


def _friendly(e: Exception) -> str:
    text = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]{11}:\s*)?", "", str(e)).strip()
    if re.search(r"not a bot|sign in to confirm", text, re.I):
        return "YouTube 要求验证（这台电脑的请求太多了），过一会儿再试。"
    if re.search(r"private video|video unavailable|not available|has been removed", text, re.I):
        return "视频不存在、是私密的，或者在你这里看不了。"
    if re.search(r"HTTP Error 404|does not exist", text, re.I):
        return "找不到这个频道或视频，检查一下地址（频道地址像 https://www.youtube.com/@TED）。"
    return f"yt-dlp 出错：{text[:200]}。{UPDATE_HINT}"


# --- Captions ---------------------------------------------------------------------------------------------------------


def _track(tracks: dict, langs: list[str]) -> str | None:
    """The json3 version of the first English track; machine translations from another language don't count."""
    for lang in langs:
        for f in tracks.get(lang) or []:
            if f.get("ext") == "json3" and "tlang=" not in f.get("url", ""):
                return f["url"]
    return None


def caption_lines(data: dict) -> list[Snippet]:
    """Caption lines as shown on screen (human-made captions only have times per line)."""
    lines = []
    for ev in data.get("events", []):
        text = "".join(s.get("utf8", "") for s in ev.get("segs") or [])
        if text.strip():
            lines.append(Snippet(text, ev.get("tStartMs", 0) / 1000, ev.get("dDurationMs", 0) / 1000))
    return lines


def caption_words(data: dict) -> list[Snippet] | None:
    """The single words of automatic captions with their own start times, or None if they have none.

    json3 gives each word an offset from its line's start but no end; a word ends when the next starts, but never
    later than a generous estimate of how long saying it takes (longer gaps are pauses).
    """
    words = []
    timed = 0
    for line, ev in enumerate(ev for ev in data.get("events", []) if ev.get("segs")):
        for seg in ev["segs"]:
            text = seg.get("utf8", "").strip()
            if text:
                timed += "tOffsetMs" in seg
                words.append(Snippet(text, (ev.get("tStartMs", 0) + seg.get("tOffsetMs", 0)) / 1000, 0.0, line))
    if not words or timed < len(words) * 0.3:  # the first word of each line has no offset; otherwise none are timed
        return None
    for w, nxt in zip(words, [*words[1:], None]):
        longest = 0.3 + 0.08 * len(w.text)
        w.duration = max(0.05, min(nxt.start - w.start, longest) if nxt else longest)
    return words


def fetch_video(video_id: str) -> Video:
    """Title, channel and English captions (human-made preferred), with word times when YouTube has them."""
    try:
        return _fetch_with_ytdlp(video_id)
    except TranscriptError:
        raise
    except Exception as e:  # yt-dlp broke: the older way still gets the captions, just without word times
        log.warning("yt-dlp failed for %s, falling back to youtube-transcript-api: %s", video_id, e)
        title, channel = fetch_metadata(video_id)
        note = f"这次没能用 yt-dlp 拿到每个词的时间（{_friendly(e)}），句子时间是按字幕估算的。"
        return Video(title, channel, None, fetch_transcript(video_id), note)


def _fetch_with_ytdlp(video_id: str) -> Video:
    with _ydl() as ydl:
        # process=False: skip picking video formats, which is slow and needs a JavaScript runtime.
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False, process=False)
        manual_langs = sorted((k for k in info.get("subtitles") or {} if k.startswith("en")),
                              key=lambda k: (k not in ENGLISH, ENGLISH.index(k) if k in ENGLISH else 0, k))
        manual_url = _track(info.get("subtitles") or {}, manual_langs)
        auto_url = _track(info.get("automatic_captions") or {}, ["en-orig", *ENGLISH])
        if not manual_url and not auto_url:
            raise TranscriptError("这个视频没有英文字幕（人工的和自动的都没有），换一个视频试试。")
        manual = json.loads(ydl.urlopen(manual_url).read()) if manual_url else None
        auto = json.loads(ydl.urlopen(auto_url).read()) if auto_url else None
    transcript = Transcript(
        snippets=caption_lines(manual or auto),
        is_generated=manual is None,
        words=caption_words(auto) if auto else None,
    )
    return Video(
        title=info.get("title") or video_id,
        channel=info.get("channel") or info.get("uploader"),
        channel_url=info.get("channel_url") or info.get("uploader_url"),
        transcript=transcript,
    )


def fetch_metadata(video_id: str) -> tuple[str, str | None]:
    """Title and channel via YouTube's public oEmbed endpoint; falls back to the video id."""
    query = urllib.parse.urlencode({"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"})
    try:
        with urllib.request.urlopen(f"https://www.youtube.com/oembed?{query}", timeout=10) as resp:
            data = json.load(resp)
        return data.get("title") or video_id, data.get("author_name")
    except Exception:
        return video_id, None


def fetch_transcript(video_id: str) -> Transcript:
    """English captions through youtube-transcript-api (times per caption line only), preferring human-made ones."""
    api = YouTubeTranscriptApi()
    try:
        listing = api.list(video_id)
        try:
            chosen = listing.find_manually_created_transcript(ENGLISH)
        except NoTranscriptFound:
            chosen = listing.find_generated_transcript(ENGLISH)
        fetched = chosen.fetch()
    except NoTranscriptFound:
        raise TranscriptError("这个视频没有英文字幕（人工的和自动的都没有），换一个视频试试。")
    except TranscriptsDisabled:
        raise TranscriptError("这个视频关闭了字幕，换一个视频试试。")
    except VideoUnavailable:
        raise TranscriptError("视频不存在或不可播放。")
    except (IpBlocked, RequestBlocked):
        raise TranscriptError("YouTube 暂时拦截了这台电脑的请求（请求太频繁或在云服务器上运行）。过一会儿再试。")
    except CouldNotRetrieveTranscript as e:
        raise TranscriptError(f"拿不到字幕：{type(e).__name__}")
    return Transcript(
        snippets=[Snippet(s.text, float(s.start), float(s.duration)) for s in fetched.snippets],
        is_generated=fetched.is_generated,
    )


# --- Channels ---------------------------------------------------------------------------------------------------------


def is_channel_url(url: str) -> bool:
    return bool(_CHANNEL_RE.search(url))


def channel_videos(url: str, limit: int = 30) -> dict:
    """A channel's latest uploads, newest first. `url` is the channel, or one of its videos."""
    try:
        match = _CHANNEL_RE.search(url)
        if match:
            base = "https://www.youtube.com/" + match.group(1)
        else:
            video_id = parse_video_id(url)  # TranscriptError if it's neither
            with _ydl() as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False, process=False)
            base = info.get("channel_url") or info.get("uploader_url")
            if not base:
                raise TranscriptError("找不到这个视频的频道。")
        # Flat: list the videos without opening each one (a fraction of a second for 30 videos).
        with _ydl(extract_flat="in_playlist", playlist_items=f"1:{limit}") as ydl:
            info = ydl.extract_info(base.rstrip("/") + "/videos", download=False)
    except TranscriptError:
        raise
    except Exception as e:
        raise TranscriptError(_friendly(e))
    thumbs = info.get("thumbnails") or []
    avatar = next((t["url"] for t in thumbs if t.get("width") and t.get("width") == t.get("height")), None)
    avatar = avatar or next((t["url"] for t in thumbs if t.get("id") == "avatar_uncropped"), None)
    return {
        "title": info.get("channel") or info.get("uploader") or re.sub(r" - Videos$", "", info.get("title") or ""),
        "url": info.get("channel_url") or base,
        "image": avatar,
        "videos": [
            {
                "video_id": e["id"],
                "title": e.get("title") or e["id"],
                "duration": e.get("duration"),
                "views": e.get("view_count"),
            }
            for e in info.get("entries") or []
            if e.get("id") and _ID_RE.match(e["id"])
        ],
    }


# --- Audio ------------------------------------------------------------------------------------------------------------


def download_audio(video_id: str, folder: Path, stem: str, on_progress: Callable[[int], None]) -> Path:
    """Only the audio track (m4a, which every browser plays, when YouTube has it), saved as folder/stem.<ext>."""
    from .media import ffmpeg  # here, not at the top: media imports segment, which imports this module

    def hook(d: dict) -> None:
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if d.get("status") == "downloading" and total:
            on_progress(int(d.get("downloaded_bytes", 0) * 100 / total))

    folder.mkdir(parents=True, exist_ok=True)
    options = {
        "format": "bestaudio[ext=m4a]/bestaudio",
        "outtmpl": str(folder / f"{stem}.%(ext)s"),
        "progress_hooks": [hook],
        "ffmpeg_location": ffmpeg(),
        "noplaylist": True,
    }
    try:
        with _ydl(**options) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    except Exception as e:
        raise TranscriptError(_friendly(e))
    done = info.get("requested_downloads") or []
    path = Path(done[0]["filepath"]) if done and done[0].get("filepath") else None
    if path is None or not path.exists():
        raise TranscriptError(f"下载完了但找不到音频文件。{UPDATE_HINT}")
    return path


def download_video(video_id: str, folder: Path, stem: str, on_progress: Callable[[int], None]) -> Path:
    """Browser-compatible H.264/AAC MP4 up to 720p; publish only a completely merged file."""
    from .media import ffmpeg

    def hook(data: dict) -> None:
        total = data.get("total_bytes") or data.get("total_bytes_estimate")
        if data.get("status") == "downloading" and total:
            on_progress(min(100, int(data.get("downloaded_bytes", 0) * 100 / total)))

    folder.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"{stem}-", dir=folder) as staging:
        target = Path(staging) / f"{stem}.mp4"
        try:
            with _ydl(
                format="bestvideo[ext=mp4][vcodec^=avc1][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc1][height<=720][acodec!=none]",
                outtmpl=str(Path(staging) / f"{stem}.%(ext)s"),
                merge_output_format="mp4", noplaylist=True,
                ffmpeg_location=ffmpeg(), progress_hooks=[hook],
                postprocessor_args={"Merger+ffmpeg_o": ["-movflags", "+faststart"]},
            ) as ydl:
                ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
        except Exception as e:
            raise TranscriptError(_friendly(e))
        if not target.is_file() or target.stat().st_size == 0:
            raise TranscriptError("视频没有准备完成，请重试。")
        final = folder / f"{stem}.mp4"
        target.replace(final)
    return final

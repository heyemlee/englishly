"""Audio files on disk: decoding with ffmpeg and Whisper transcription."""

import asyncio
import os
import re
import shutil
import subprocess
from functools import cache
from pathlib import Path

import numpy as np

from .config import DB_PATH
from .segment import Word

# Next to the database, so a different DB_PATH (e.g. for testing) also gets its own audio.
AUDIO_DIR = DB_PATH.parent / "audio"
PARTIAL = {".part", ".ytdl"}  # unfinished downloads

WHISPER_LOCK = asyncio.Lock()  # one Whisper job at a time (podcasts and YouTube audio): the model is big

# Whisper splits "all-ears" into "all" + "-ears" and "it's" sometimes into "it" + "'s"; these attach to the previous word.
_ATTACHES = re.compile(r"^(-|\.\w|['’](s|re|ve|ll|d|m|t)$|n['’]t$)|^[^\w$£€]+$", re.I)

# large-v3-turbo is accurate and fast on Apple Silicon; the first run downloads it (~1.6 GB) from Hugging Face.
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")


class MediaError(Exception):
    """Raised with a message that can be shown to the learner as-is."""


@cache
def ffmpeg() -> str:
    """System ffmpeg if there is one, else the static build that ships with the imageio-ffmpeg package."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def decode(path: Path, sample_rate: int = 16000) -> np.ndarray:
    """Mono float32 samples."""
    cmd = [ffmpeg(), "-nostdin", "-loglevel", "error",
           "-i", str(path), "-f", "s16le", "-ac", "1", "-acodec", "pcm_s16le", "-ar", str(sample_rate), "-"]
    try:
        out = subprocess.run(cmd, capture_output=True, check=True).stdout
    except subprocess.CalledProcessError as e:
        raise MediaError(f"音频解码失败：{e.stderr.decode(errors='ignore')[-200:]}")
    return np.frombuffer(out, np.int16).astype(np.float32) / 32768.0


def whisper_status() -> tuple[bool, str]:
    """Whether local Whisper can run here, and why not."""
    try:
        import mlx.core  # noqa: F401  (fails without Apple Silicon / Metal)
        import mlx_whisper  # noqa: F401
    except Exception as e:  # ImportError, or a Metal device error raised at import time
        return False, f"本机跑不了 Whisper（需要 Apple Silicon 的 Mac，并装好 mlx-whisper）：{e}"
    return True, ""


def transcribe(path: Path) -> list[Word]:
    """Words with precise timestamps. Slow: run it in a worker thread."""
    import mlx_whisper

    result = mlx_whisper.transcribe(
        decode(path),
        path_or_hf_repo=WHISPER_MODEL,
        language="en",
        word_timestamps=True,
        condition_on_previous_text=False,  # avoids runaway repetition on long podcasts
        hallucination_silence_threshold=2.0,
    )
    return whisper_words(result.get("segments", []))


def whisper_words(segments: list[dict]) -> list[Word]:
    words: list[Word] = []
    for i, seg in enumerate(segments):
        for w in seg.get("words", []):
            text = w["word"].strip()
            if not text:
                continue
            start, end = float(w["start"]), max(float(w["end"]), float(w["start"]) + 0.01)
            if words and _ATTACHES.search(text):
                prev = words[-1]
                words[-1] = Word(prev.text + text, prev.start, max(prev.end, end), prev.snippet)
            else:
                words.append(Word(text, start, end, i))
    return words

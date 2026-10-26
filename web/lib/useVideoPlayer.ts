"use client";

import { useEffect, useRef, useState } from "react";
import { useRangePlayback, type MediaControls } from "@/lib/useRangePlayback";

/**
 * A plain video file, using the same sentence/loop engine as audio and YouTube. The playing time isn't kept as state
 * here (it would re-render the whole practice page several times a second): SimpleVideoPlayer follows it itself.
 */
export function useVideoPlayer(src: string | null) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controls = useRef<MediaControls | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const { playRange, stop, seekTo, clearTimers, readPlayback } = useRangePlayback(controls);

  useEffect(() => {
    const el = videoRef.current;
    if (!src || !el) return;
    const update = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onReady = () => {
      controls.current = {
        seek: (t) => {
          el.currentTime = Math.min(t, el.duration);
        },
        play: () => {
          void el.play().catch((cause: DOMException) => {
            // A scrub/stop can cancel an earlier play promise while a later play is already succeeding.
            if (cause.name !== "AbortError") setError("视频暂时无法播放，请再点一次播放。");
          });
        },
        pause: () => el.pause(),
        currentTime: () => el.currentTime,
        isPlaying: () => !el.paused && !el.ended,
        setRate: (r) => { el.playbackRate = r; },
      };
      setError(null);
      setReady(true);
      update();
    };
    const onError = () => setError("视频加载失败，请刷新页面重试。");
    const onPlaying = () => setError(null);
    const events = ["durationchange"] as const;
    events.forEach((name) => el.addEventListener(name, update));
    el.addEventListener("loadedmetadata", onReady);
    el.addEventListener("error", onError);
    el.addEventListener("playing", onPlaying);
    if (el.readyState >= 1) onReady();
    return () => {
      events.forEach((name) => el.removeEventListener(name, update));
      el.removeEventListener("loadedmetadata", onReady);
      el.removeEventListener("error", onError);
      el.removeEventListener("playing", onPlaying);
      clearTimers();
      el.pause();
      controls.current = null;
      setReady(false);
    };
  }, [src, clearTimers]);

  return { videoRef, ready, error, duration, playRange, stop, seekTo, readPlayback };
}

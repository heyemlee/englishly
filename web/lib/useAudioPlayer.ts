"use client";

import { useEffect, useRef, useState } from "react";

import { useRangePlayback, type MediaControls } from "@/lib/useRangePlayback";

/** An <audio> element (attach audioRef to it) driven sentence by sentence. Pass null to skip. */
export function useAudioPlayer(src: string | null) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const controls = useRef<MediaControls | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { playRange, stop, clearTimers, readPlayback } = useRangePlayback(controls);

  useEffect(() => {
    const audio = audioRef.current;
    if (!src || !audio) return;
    const onReady = () => {
      controls.current = {
        seek: (t) => {
          audio.currentTime = t;
        },
        play: () => void audio.play().catch(() => undefined),
        pause: () => audio.pause(),
        currentTime: () => audio.currentTime,
        isPlaying: () => !audio.paused && !audio.ended,
        setRate: (r) => {
          audio.playbackRate = r;
        },
      };
      setReady(true);
    };
    const onError = () => setError("音频加载失败：确认后端在运行，或者到首页重试这个节目。");
    audio.addEventListener("loadedmetadata", onReady);
    audio.addEventListener("error", onError);
    if (audio.readyState >= 1) onReady();
    return () => {
      audio.removeEventListener("loadedmetadata", onReady);
      audio.removeEventListener("error", onError);
      clearTimers();
      audio.pause();
      controls.current = null;
      setReady(false);
    };
  }, [src, clearTimers]);

  return { audioRef, ready, error, playRange, stop, readPlayback };
}

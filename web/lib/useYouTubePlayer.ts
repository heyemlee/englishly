"use client";

import { useEffect, useRef, useState } from "react";

import { useRangePlayback, type MediaControls } from "@/lib/useRangePlayback";

// Minimal typings for the parts of the YouTube IFrame Player API we use.
type YTPlayer = {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  unloadModule?(name: string): void;
  destroy(): void;
};

type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(window.YT!);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}

const PLAYING = 1;

/** YouTube's embedded player. Pass null to skip loading it (e.g. for podcast episodes). */
export function useYouTubePlayer(videoId: string | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controls = useRef<MediaControls | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { playRange, stop, clearTimers, readPlayback } = useRangePlayback(controls);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!videoId || !container) return;
    let player: YTPlayer | null = null;
    loadApi().then((YT) => {
      if (cancelled) return;
      // YT replaces the element it's given, so hand it a child React doesn't manage.
      const el = document.createElement("div");
      container.appendChild(el);
      const hideCaptions = () => {
        try {
          player?.unloadModule?.("captions"); // keep YouTube's own subtitles off for blind listening
        } catch {
          // not supported; harmless
        }
      };
      player = new YT.Player(el, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, playsinline: 1, cc_load_policy: 0, iv_load_policy: 3, origin: window.location.origin },
        events: {
          onReady: () => {
            hideCaptions();
            const p = player!;
            controls.current = {
              seek: (t) => p.seekTo(t, true),
              play: () => p.playVideo(),
              pause: () => p.pauseVideo(),
              currentTime: () => p.getCurrentTime(),
              isPlaying: () => p.getPlayerState() === PLAYING,
              setRate: (r) => p.setPlaybackRate(r),
            };
            setReady(true);
          },
          onStateChange: (e) => {
            if (e.data === PLAYING) hideCaptions();
          },
          onError: (e) => {
            setError(
              e.data === 101 || e.data === 150
                ? "作者不允许这个视频在别的网站嵌入播放，只能换一个视频。"
                : `播放器出错（代码 ${e.data}）。`,
            );
          },
        },
      });
    });
    return () => {
      cancelled = true;
      clearTimers();
      try {
        player?.destroy();
      } catch {
        // already gone
      }
      controls.current = null;
      container.innerHTML = "";
      setReady(false);
    };
  }, [videoId, clearTimers]);

  return { containerRef, ready, error, playRange, stop, readPlayback };
}

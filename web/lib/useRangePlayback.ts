"use client";

import { useCallback, useEffect, useRef } from "react";

/** What a player has to offer for sentence-by-sentence playback (YouTube iframe or <audio>). */
export type MediaControls = {
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  currentTime(): number;
  setRate(rate: number): void;
  isPlaying(): boolean;
};

export type PlayOptions = {
  rate?: number;
  loops?: number; // how many times to play the range; Infinity loops until stopped
  gap?: number; // pause between loops, seconds
  onTick?: (time: number) => void;
  onEnd?: () => void;
};

/** Play [start, end) with optional looping, by polling the player's clock (neither player has a precise "time reached" event). */
export function useRangePlayback(controls: React.RefObject<MediaControls | null>) {
  const timerRef = useRef<number | null>(null);
  const gapRef = useRef<number | null>(null);
  const readPlayback = useCallback(() => ({
    time: controls.current?.currentTime() ?? 0,
    playing: controls.current?.isPlaying() ?? false,
  }), [controls]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (gapRef.current) window.clearTimeout(gapRef.current);
    timerRef.current = null;
    gapRef.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const stop = useCallback(() => {
    clearTimers();
    controls.current?.pause();
  }, [clearTimers, controls]);

  const seekTo = useCallback((time: number) => {
    if (!Number.isFinite(time)) return;
    clearTimers(); // a scrub cancels the previous sentence/loop boundary
    controls.current?.seek(Math.max(0, time));
  }, [clearTimers, controls]);

  const playRange = useCallback(
    (start: number, end: number, opts: PlayOptions = {}) => {
      const media = controls.current;
      if (!media) return;
      clearTimers();
      const { rate = 1, gap = 0.6, onTick, onEnd } = opts;
      let loopsLeft = opts.loops ?? 1;
      media.setRate(rate);

      const runOnce = () => {
        media.seek(start);
        media.play();
        // Right after a seek the reported time can still be the old position; wait until it's inside the range.
        let armed = false;
        const startedAt = performance.now();
        timerRef.current = window.setInterval(() => {
          const t = media.currentTime();
          if (!armed) {
            armed = (t >= start - 1 && t < end - 0.05) || performance.now() - startedAt > 1500;
            return;
          }
          onTick?.(t);
          if (t < end) return;
          media.pause();
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          loopsLeft -= 1;
          if (loopsLeft > 0) {
            gapRef.current = window.setTimeout(runOnce, gap * 1000);
          } else {
            onEnd?.();
          }
        }, 30);
      };
      runOnce();
    },
    [clearTimers, controls],
  );

  return { playRange, stop, seekTo, clearTimers, readPlayback };
}

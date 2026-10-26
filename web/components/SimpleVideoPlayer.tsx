"use client";

import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/api";
import { IconPause, IconPlay } from "@/components/icons";
import { Spinner } from "@/components/ui";

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  src: string;
  ready: boolean;
  duration: number;
  onToggle: () => void;
  onSeek: (time: number, resume: boolean) => void;
};

export default function SimpleVideoPlayer({ videoRef, src, ready, duration, onToggle, onSeek }: Props) {
  // The clock and the play state live here, so only this bar re-renders while the video plays.
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const update = () => {
      setTime(el.currentTime);
      setPlaying(!el.paused && !el.ended);
    };
    const events = ["timeupdate", "play", "pause", "ended", "seeked", "loadedmetadata"] as const;
    events.forEach((name) => el.addEventListener(name, update));
    update();
    return () => events.forEach((name) => el.removeEventListener(name, update));
  }, [videoRef, src]);
  const [preview, setPreview] = useState<number | null>(null);
  const resume = useRef<boolean | null>(null);
  const dragging = useRef(false);
  const position = Math.min(duration, preview ?? time);
  const filled = duration > 0 ? (position / duration) * 100 : 0;
  const commit = (value: number) => {
    if (!ready || !Number.isFinite(value)) return;
    onSeek(value, resume.current ?? playing);
    resume.current = null;
    setPreview(null);
  };

  return <section className="glass overflow-hidden rounded-3xl p-1.5" aria-label="视频播放器">
    <div className="relative aspect-video overflow-hidden rounded-[1.15rem] bg-black">
      <video ref={videoRef} src={src} playsInline preload="auto" disablePictureInPicture
        className="h-full w-full object-contain" aria-label="学习视频" />
      <button type="button" disabled={!ready} onClick={onToggle} aria-label={playing ? "暂停视频画面" : "播放视频画面"}
        title="点击画面播放或暂停" className="absolute inset-0 grid place-items-center focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-white">
        {!ready && <Spinner className="size-6 text-white" />}
        <span className="sr-only">{playing ? "暂停" : "播放"}</span>
      </button>
    </div>
    <div className="flex items-center gap-2.5 px-2 pb-0.5 pt-1.5 sm:gap-3">
      <button type="button" disabled={!ready} onClick={onToggle} aria-label={playing ? "暂停视频" : "播放视频"}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition-[opacity,transform] active:scale-95 disabled:opacity-35">
        {playing ? <IconPause className="size-4" /> : <IconPlay className="size-4 translate-x-px" />}
      </button>
      <span className="shrink-0 text-xs tabular-nums text-muted">{formatTime(position)}</span>
      <input type="range" aria-label="视频播放进度" aria-valuetext={`${formatTime(position)} / ${formatTime(duration)}`}
        min={0} max={duration || 1} step={0.1} value={position} disabled={!ready || duration <= 0}
        style={{ "--p": `${filled}%` } as React.CSSProperties}
        onPointerDown={() => { dragging.current = true; resume.current = playing; }}
        onChange={(e) => setPreview(Number(e.target.value))}
        onPointerUp={(e) => { dragging.current = false; commit(Number(e.currentTarget.value)); }}
        onPointerCancel={() => { dragging.current = false; resume.current = null; setPreview(null); }}
        onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) commit(Number(e.currentTarget.value)); }}
        onBlur={(e) => { if (preview !== null && !dragging.current) commit(Number(e.currentTarget.value)); }}
        className="range min-w-0 flex-1 cursor-pointer disabled:cursor-default disabled:opacity-50" />
      <span className="shrink-0 pr-1 text-xs tabular-nums text-muted">{formatTime(duration)}</span>
    </div>
  </section>;
}

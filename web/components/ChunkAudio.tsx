"use client";

import { useEffect } from "react";
import { mediaUrl, type SavedChunk } from "@/lib/api";
import { useAudioPlayer } from "@/lib/useAudioPlayer";
import { useYouTubePlayer } from "@/lib/useYouTubePlayer";
import { IconReplay, IconStop, IconX } from "@/components/icons";
import { Btn, ErrorBar, IconBtn } from "@/components/ui";

export default function ChunkAudio({ chunk, onClose }: { chunk: SavedChunk; onClose: () => void }) {
  const useAudio = !!chunk.has_audio;
  const { containerRef, ...video } = useYouTubePlayer(useAudio ? null : chunk.video_id);
  const { audioRef, ...audio } = useAudioPlayer(useAudio && chunk.episode_id !== null ? mediaUrl(chunk.episode_id) : null);
  const { ready, playRange, stop, error } = useAudio ? audio : video;
  useEffect(() => {
    if (ready && chunk.start_s !== null && chunk.end_s !== null) playRange(Math.max(0, chunk.start_s - 0.1), chunk.end_s + 0.25, { loops: 1 });
  }, [ready, playRange, chunk.start_s, chunk.end_s]);
  return <section className="glass space-y-4 rounded-3xl p-5" aria-label="原声回放">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-xs text-muted">{chunk.episode_title}</p>
        <p className="font-semibold">{chunk.pattern}</p>
      </div>
      <IconBtn label="关闭原声回放" onClick={() => { stop(); onClose(); }} className="size-8">
        <IconX className="size-4" />
      </IconBtn>
    </div>
    {useAudio && chunk.episode_id !== null ? <audio ref={audioRef} src={mediaUrl(chunk.episode_id)} controls className="w-full" />
      : <div ref={containerRef} className="mx-auto aspect-video max-w-lg overflow-hidden rounded-2xl bg-black" />}
    <p className="leading-relaxed">{chunk.sentence_text}</p>
    <div className="flex gap-2">
      <Btn small disabled={!ready} onClick={() => playRange(Math.max(0, (chunk.start_s ?? 0) - 0.1), (chunk.end_s ?? 0) + 0.25, { loops: 1 })}>
        <IconReplay className="size-3.5" /> 重播
      </Btn>
      <Btn small onClick={stop}><IconStop className="size-3" /> 停止</Btn>
    </div>
    <ErrorBar message={error} />
  </section>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { api, loadPref, savePref, type LearningProgress, type ListeningEvent, type Sentence } from "@/lib/api";

/** Count advancing media, not page-open time. Persist unsent events and retry with stable IDs. */
export function useLearningProgress(
  episodeId: number,
  sentences: Sentence[],
  readPlayback: () => { time: number; playing: boolean },
  onProgress: (progress: LearningProgress) => void,
) {
  const latest = useRef({ sentences, onProgress });
  const [syncError, setSyncError] = useState(false);
  useEffect(() => { latest.current = { sentences, onProgress }; });
  useEffect(() => {
    const storageKey = `listening.pending.v1:${episodeId}`;
    let queue = loadPref<ListeningEvent[]>(storageKey, []);
    if (!Array.isArray(queue)) queue = [];
    let busy = false;
    let inFlight = new Set<string>();
    let disposed = false;
    const acknowledged = new Set<string>();
    const owned = new Set<string>();
    let previous: { time: number; playing: boolean; wall: number } | null = null;
    const persist = () => {
      // Another mounted view or Strict Mode cleanup may have persisted newer events in the meantime.
      const stored = loadPref<ListeningEvent[]>(storageKey, []);
      queue = [...new Map([...(Array.isArray(stored) ? stored : []), ...queue]
        .filter((event) => !acknowledged.has(event.id)).map((event) => [event.id, event])).values()];
      savePref(storageKey, queue);
    };
    const flush = async (keepalive = false) => {
      if (busy || !queue.length) return;
      const batch = queue.slice(0, 80);
      busy = true;
      inFlight = new Set(batch.map((event) => event.id));
      try {
        const result = await api.saveListening(episodeId, batch, keepalive);
        const sent = new Set(batch.map((event) => event.id));
        sent.forEach((id) => acknowledged.add(id));
        queue = queue.filter((event) => !sent.has(event.id));
        persist();
        if (!disposed) { latest.current.onProgress(result); setSyncError(false); }
      } catch {
        if (!disposed) setSyncError(true);
      } finally { busy = false; inFlight = new Set(); }
    };
    const tick = window.setInterval(() => {
      const current = { ...readPlayback(), wall: performance.now() / 1000 };
      if (previous && (previous.playing || current.playing)) {
        const delta = current.time - previous.time;
        const wall = current.wall - previous.wall;
        // Skip seeks, stalls and long throttled windows whose actual playback cannot be established.
        if (delta > 0.02 && delta < 3 && wall > 0 && wall < 3 && delta / wall < 2) {
          for (const sentence of latest.current.sentences) {
            const start = Math.max(previous.time, sentence.start);
            const end = Math.min(current.time, sentence.end);
            if (end <= start) continue;
            const seconds = wall * (end - start) / delta;
            const tail = queue[queue.length - 1];
            if (tail && owned.has(tail.id) && tail.sentence_id === sentence.id && !inFlight.has(tail.id)
                && Math.abs(tail.end - start) < 0.1 && tail.seconds + seconds < 15 && end - tail.start < 20) {
              tail.end = end;
              tail.seconds += seconds;
            } else {
              const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
              owned.add(id);
              queue.push({
                id,
                sentence_id: sentence.id, start, end, seconds,
              });
            }
          }
          persist();
          if (queue.length >= 60) void flush();
        }
      }
      previous = current;
    }, 250);
    const timer = window.setInterval(() => void flush(), 10000);
    const onHide = () => { if (document.visibilityState === "hidden") void flush(true); };
    const onExit = () => void flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onExit);
    void flush();
    return () => {
      disposed = true;
      window.clearInterval(tick);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onExit);
      persist();
      void flush(true);
    };
  }, [episodeId, readPlayback]);
  return syncError;
}

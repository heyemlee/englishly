"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, episodeHref, formatTime, type Health, type PodcastFeed, type PodcastShow } from "@/lib/api";
import { IconChevronLeft } from "@/components/icons";
import { Btn, Composer, ErrorBar, IconBtn } from "@/components/ui";

/** Find a podcast (Apple Podcasts search, or paste its RSS address), pick an episode, transcribe it with Whisper. */
export default function PodcastImport({ health, initialFeedUrl = null }: { health: Health | null; initialFeedUrl?: string | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [shows, setShows] = useState<PodcastShow[] | null>(null);
  const [feed, setFeed] = useState<PodcastFeed | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Opened from a show's "更多集": load that feed right away.
  useEffect(() => {
    if (!initialFeedUrl) return;
    api
      .podcastFeed(initialFeedUrl)
      .then(setFeed)
      .catch((e: Error) => setError(e.message));
  }, [initialFeedUrl]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    void run(async () => {
      if (/^https?:\/\//i.test(q)) {
        setShows(null);
        setFeed(await api.podcastFeed(q));
      } else {
        setFeed(null);
        setShows(await api.searchPodcasts(q));
      }
    });
  };

  const open = (show: PodcastShow) => void run(async () => setFeed(await api.podcastFeed(show.feed_url)));

  const importEpisode = async (guid: string) => {
    if (!feed) return;
    setImporting(guid);
    setError(null);
    try {
      const { id } = await api.importPodcast(feed.feed_url, guid);
      router.push(episodeHref(id));
    } catch (e) {
      setError((e as Error).message);
      setImporting(null);
    }
  };

  return (
    <div className="space-y-3">
      <Composer value={query} onChange={setQuery} onSubmit={submit} busy={busy} placeholder="搜索播客，或粘贴 RSS 地址" label="搜索播客" submitLabel="查找" />
      {health && !health.whisper.available && <ErrorBar message={health.whisper.reason} />}
      <ErrorBar message={error} onClose={() => setError(null)} />

      {shows && !feed && (
        shows.length === 0 ? (
          <p className="px-5 text-sm text-muted">没有找到。</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {shows.map((s) => (
              <li key={s.feed_url}>
                <button
                  onClick={() => open(s)}
                  className="glass flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors hover:bg-(--glass-strong)"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s.image && <img src={s.image} alt="" className="size-12 shrink-0 rounded-xl object-cover" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{s.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {s.author}
                      {s.episodes ? ` · ${s.episodes} 集` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {feed && (
        <div className="glass overflow-hidden rounded-3xl">
          <div className="flex items-center gap-3 p-3 sm:p-4">
            {shows && (
              <IconBtn label="返回搜索结果" onClick={() => setFeed(null)} className="size-9">
                <IconChevronLeft className="size-4" />
              </IconBtn>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {feed.image && <img src={feed.image} alt="" className="size-12 shrink-0 rounded-xl object-cover" />}
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{feed.title}</div>
              <div className="truncate text-xs text-muted">{feed.author}</div>
            </div>
          </div>
          <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto border-t border-border">
            {feed.episodes.length === 0 && <li className="p-4 text-sm text-muted">这个 RSS 里没有音频。</li>}
            {feed.episodes.map((ep) => (
              <li key={ep.guid} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 text-sm">
                  <div className="line-clamp-2 font-medium leading-snug">{ep.title}</div>
                  <div className="mt-0.5 text-xs text-subtle">
                    {[ep.published, ep.duration ? formatTime(ep.duration) : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {ep.episode_id ? (
                  <Btn small onClick={() => router.push(episodeHref(ep.episode_id!))}>
                    去练习
                  </Btn>
                ) : (
                  <Btn
                    small
                    primary
                    title="导入后在后台下载并转写"
                    onClick={() => importEpisode(ep.guid)}
                    disabled={importing !== null || (health !== null && !health.whisper.available)}
                  >
                    {importing === ep.guid ? "导入中…" : "导入"}
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

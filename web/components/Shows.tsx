"use client";

import Link from "next/link";
import { useState } from "react";

import { episodeHref, formatTime, thumbnail, type EpisodeSummary } from "@/lib/api";
import { parseStamp } from "@/lib/time";
import { IconChevronDown, IconPlay, IconTrash } from "@/components/icons";
import { cx, Progress } from "@/components/ui";

type Show = {
  key: string;
  title: string;
  source: "youtube" | "podcast";
  more: string; // where 「更多集」 looks: the RSS feed, the YouTube channel, or (channel unknown yet) one of its videos
  image: string | null;
  episodes: EpisodeSummary[];
  sentences: number;
  practiced: number;
  last: number; // ms timestamp of the latest practice (or import)
};

function groupShows(episodes: EpisodeSummary[]): Show[] {
  const shows = new Map<string, Show>();
  for (const ep of episodes) {
    const key = ep.source === "podcast" && ep.feed_url ? `podcast:${ep.feed_url}` : `youtube:${ep.channel ?? ""}`;
    let show = shows.get(key);
    if (!show) {
      show = {
        key,
        title: ep.channel || "未知频道",
        source: ep.source,
        more: ep.feed_url ?? ep.channel_url ?? `https://www.youtube.com/watch?v=${ep.video_id}`,
        image: thumbnail(ep),
        episodes: [],
        sentences: 0,
        practiced: 0,
        last: 0,
      };
      shows.set(key, show);
    }
    show.episodes.push(ep);
    if (ep.channel_url) show.more = ep.channel_url;
    show.sentences += ep.sentence_count;
    show.practiced += ep.studied_count ?? ep.practiced_count;
    show.last = Math.max(show.last, parseStamp(ep.last_activity_at ?? ep.last_practiced_at ?? ep.created_at).getTime());
  }
  return [...shows.values()].sort((a, b) => b.last - a.last);
}

/** The episode to pick up next: the latest one you were in the middle of, else the newest you haven't started. */
function nextEpisode(show: Show): EpisodeSummary | null {
  const ready = show.episodes.filter((e) => e.status === "ready");
  const inProgress = ready
    .filter((e) => !!e.last_activity_at && (e.studied_count ?? e.practiced_count) < e.sentence_count)
    .sort((a, b) => (b.last_activity_at ?? b.last_practiced_at ?? "").localeCompare(a.last_activity_at ?? a.last_practiced_at ?? ""));
  return inProgress[0] ?? ready.find((e) => (e.studied_count ?? e.practiced_count) === 0) ?? ready[0] ?? null;
}

function ago(ms: number) {
  const days = Math.floor((Date.now() - ms) / 86400000);
  return days <= 0 ? "今天" : days === 1 ? "昨天" : `${days} 天前`;
}

const LINK_BUTTON = "inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] text-muted transition-colors hover:bg-fill hover:text-foreground";

export default function ShowList({
  episodes,
  onMore,
  onRetry,
  onRemove,
}: {
  episodes: EpisodeSummary[];
  onMore?: (source: "youtube" | "podcast", url: string) => void; // not on a cloud server
  onRetry: (ep: EpisodeSummary) => void;
  onRemove: (ep: EpisodeSummary) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const shows = groupShows(episodes);
  return (
    <ul className="space-y-3">
      {shows.map((show) => {
        const next = nextEpisode(show);
        const expanded = open === show.key;
        return (
          <li key={show.key} className="glass overflow-hidden rounded-3xl">
            <div className="flex items-center gap-3.5 p-3 sm:gap-4 sm:p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={show.image ?? undefined}
                alt=""
                loading="lazy"
                className={cx("shrink-0 rounded-2xl bg-fill object-cover", show.source === "podcast" ? "size-16" : "h-16 w-28 sm:h-[4.5rem] sm:w-32")}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <h3 className="truncate font-semibold">{show.title}</h3>
                  <span className="shrink-0 text-xs text-subtle">{show.source === "podcast" ? "播客" : "YouTube"}</span>
                </div>
                {next && <p className="truncate text-sm text-muted">{next.title}</p>}
                <div className="mt-2 flex items-center gap-2">
                  <Progress value={show.practiced / Math.max(show.sentences, 1)} label="节目进度" className="w-full max-w-52" />
                  <span className="shrink-0 text-xs tabular-nums text-subtle">
                    {show.practiced}/{show.sentences}
                  </span>
                </div>
              </div>
              {next && (
                <Link
                  href={episodeHref(next.id)}
                  aria-label={`${next.last_activity_at ? "继续" : "开始"}：${next.title}`}
                  title={`${next.last_activity_at ? "继续" : "开始"}：${next.title}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-foreground text-background transition hover:opacity-85 active:scale-95"
                >
                  <IconPlay className="size-[18px] translate-x-px" />
                </Link>
              )}
            </div>
            <div className="flex items-center gap-1 border-t border-border py-1.5 pl-4 pr-2">
              <span className="text-xs text-subtle">
                {show.episodes.length} 集 · {ago(show.last)}
              </span>
              <span className="ml-auto flex">
                {onMore && (
                  <button onClick={() => onMore(show.source, show.more)} className={LINK_BUTTON}>
                    更多集
                  </button>
                )}
                <button onClick={() => setOpen(expanded ? null : show.key)} aria-expanded={expanded} className={LINK_BUTTON}>
                  {expanded ? "收起" : "全部"}
                  <IconChevronDown className={cx("size-3.5 transition-transform", expanded && "rotate-180")} />
                </button>
              </span>
            </div>
            {expanded && (
              <ul className="divide-y divide-border border-t border-border text-sm">
                {show.episodes.map((ep) => (
                  <li key={ep.id} className="flex items-center gap-3 py-1.5 pl-4 pr-2">
                    <Link href={episodeHref(ep.id)} className="min-w-0 flex-1 truncate py-1.5 hover:underline">
                      {ep.title}
                    </Link>
                    <span className={cx("shrink-0 text-xs tabular-nums", ep.status === "failed" ? "text-bad" : "text-subtle")}>
                      {ep.status === "ready"
                        ? `${formatTime(ep.duration)} · ${ep.studied_count ?? ep.practiced_count}/${ep.sentence_count}`
                        : ep.status === "failed"
                          ? "处理失败"
                          : "处理中…"}
                    </span>
                    {ep.status === "failed" && (
                      <button onClick={() => onRetry(ep)} className="shrink-0 text-xs font-medium hover:underline">
                        重试
                      </button>
                    )}
                    <button
                      onClick={() => onRemove(ep)}
                      aria-label={`删除「${ep.title}」`}
                      title="删除"
                      className="grid size-8 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:bg-fill hover:text-bad"
                    >
                      <IconTrash className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

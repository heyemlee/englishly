"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, episodeHref, formatTime, thumbnail, type EpisodeSummary } from "@/lib/api";
import { parseStamp } from "@/lib/time";
import { usePref } from "@/lib/usePref";
import { IconStarFilled } from "@/components/icons";
import { Card, ErrorBar, PageTitle, Segmented, Spinner } from "@/components/ui";

const TABS = ["recent", "done", "starred"] as const;
const TAB_LABEL = { recent: "最近学习", done: "已完成", starred: "已收藏" };
const EMPTY = { recent: "还没有学习记录", done: "还没有学完的节目", starred: "还没有收藏的节目" };
const LIMIT = 30; // recent and done only: starred ones are all listed

const studied = (ep: EpisodeSummary) => ep.studied_count ?? ep.practiced_count;
// Every sentence heard or practised once — the same "学完一遍" as the home page's filter.
const finished = (ep: EpisodeSummary) => ep.sentence_count > 0 && studied(ep) >= ep.sentence_count;
// How far into the episode the learner got: the sentence they were on.
const reached = (ep: EpisodeSummary) =>
  ep.last_sentence_idx === null || ep.last_sentence_idx === undefined
    ? 0
    : Math.ceil(((ep.last_sentence_idx + 1) / Math.max(ep.sentence_count, 1)) * 100);

function dayText(stamp: string) {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const when = parseStamp(stamp);
  const days = Math.round((day(new Date()) - day(when)) / 86400000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return when.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function length(seconds: number) {
  return seconds >= 60 ? `${Math.round(seconds / 60)} 分钟` : formatTime(seconds);
}

export default function HistoryPage() {
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = usePref<(typeof TABS)[number]>("history.tab", "recent");

  useEffect(() => {
    api
      .episodes()
      .then(setEpisodes)
      .catch((e: Error) => setError(e.message));
  }, []);

  const matching =
    tab === "starred"
      ? (episodes ?? []).filter((ep) => ep.starred_at).sort((a, b) => b.starred_at!.localeCompare(a.starred_at!))
      : (episodes ?? [])
          .filter((ep) => ep.status === "ready" && ep.last_activity_at && (tab === "recent" || finished(ep)))
          .sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""));
  const shown = tab === "starred" ? matching : matching.slice(0, LIMIT);

  return (
    <div className="space-y-6">
      <PageTitle
        title="学习记录"
        action={<Segmented label="查看" options={TABS} value={tab} onChange={setTab} format={(t) => TAB_LABEL[t]} />}
      />
      <ErrorBar message={error} onClose={() => setError(null)} />
      {episodes === null && !error && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> 加载中
        </p>
      )}
      {episodes !== null && shown.length === 0 && (
        <Card pad="roomy" className="text-center text-muted">
          {EMPTY[tab]}
        </Card>
      )}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {shown.map((ep) => {
          const done = finished(ep);
          const percent = done ? 100 : reached(ep);
          return (
            <li key={ep.id}>
              <Link
                href={episodeHref(ep.id, ep.last_sentence_idx)}
                className="glass flex items-center gap-3.5 rounded-3xl p-2.5 transition-colors hover:bg-(--glass-strong) sm:block sm:p-2"
              >
                <div className="relative w-32 shrink-0 overflow-hidden rounded-2xl sm:w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbnail(ep) ?? undefined} alt="" className="aspect-video w-full bg-fill object-cover" />
                  {ep.starred_at && (
                    <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md" title="已收藏">
                      <IconStarFilled className="size-3.5" />
                    </span>
                  )}
                  {ep.duration > 0 && (
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-md">
                      {length(ep.duration)}
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/30" aria-hidden="true">
                    <span className="block h-full bg-white" style={{ width: `${percent}%` }} />
                  </span>
                </div>
                <div className="min-w-0 flex-1 sm:px-2.5 sm:pb-2.5 sm:pt-3">
                  <div className="line-clamp-2 text-[15px] font-medium leading-snug">{ep.title}</div>
                  <div className="mt-1 text-[13px] text-muted">
                    {ep.last_activity_at
                      ? `学习于${dayText(ep.last_activity_at)}，${done ? "已学完" : `看至 ${percent}%`}`
                      : `收藏于${dayText(ep.starred_at!)}，还没开始`}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {matching.length > shown.length && <p className="text-center text-xs text-subtle">只显示最近 {LIMIT} 条</p>}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, episodeHref, formatTime, thumbnail, type EpisodeSummary, type Health, type ReviewSummary } from "@/lib/api";
import { usePref } from "@/lib/usePref";
import ChannelVideos from "@/components/ChannelVideos";
import PodcastImport from "@/components/PodcastImport";
import ShowList from "@/components/Shows";
import TodayLearning from "@/components/TodayLearning";
import { IconSearch, IconTrash } from "@/components/icons";
import { Composer, cx, ErrorBar, Progress, Segmented } from "@/components/ui";

const CHANNEL_URL = /youtube\.com\/(@|channel\/|c\/|user\/)/i;
const SOURCES = ["youtube", "podcast"] as const;
const VIEWS = ["shows", "all"] as const;
const SELECT = "field h-11 shrink-0 rounded-full pl-4 sm:h-10";

export default function Home() {
  const router = useRouter();
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [source, setSource] = useState<"youtube" | "podcast">("youtube");
  const [feedToOpen, setFeedToOpen] = useState<string | null>(null);
  const [channelToOpen, setChannelToOpen] = useState<string | null>(null);
  const [view, chooseView] = usePref<"shows" | "all">("home.view", "shows");
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [duration, setDuration] = useState("all");
  const [practiceState, setPracticeState] = useState("all");
  const [mediaFilter, setMediaFilter] = useState("all");

  useEffect(() => {
    api
      .episodes()
      .then(setEpisodes)
      .catch((e: Error) => setError(e.message));
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
    api
      .reviewQueue()
      .then((q) => setReview(q.summary))
      .catch(() => setReview(null));
  }, []);

  const openMore = (kind: "youtube" | "podcast", url: string) => {
    setSource(kind);
    if (kind === "podcast") setFeedToOpen(url);
    else setChannelToOpen(url);
    document.getElementById("add")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Podcast episodes are transcribed in the background: refresh while any is still working.
  const processing = episodes?.some((ep) => ep.status === "processing") ?? false;
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => {
      api.episodes().then(setEpisodes).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [processing]);

  async function retry(ep: EpisodeSummary) {
    try {
      await api.retryEpisode(ep.id);
      setEpisodes((list) => list?.map((x) => (x.id === ep.id ? { ...x, status: "processing", status_detail: "排队中…" } : x)) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function importVideo() {
    if (!url.trim() || importing) return;
    if (CHANNEL_URL.test(url)) {
      setChannelToOpen(url.trim()); // a channel: list its videos to pick from
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const ep = await api.importEpisode(url.trim());
      router.push(episodeHref(ep.id));
    } catch (err) {
      setError((err as Error).message);
      setImporting(false);
    }
  }

  async function remove(ep: EpisodeSummary) {
    if (!confirm(`删除「${ep.title}」和它的练习记录？`)) return;
    try {
      await api.deleteEpisode(ep.id);
      setEpisodes((list) => list?.filter((x) => x.id !== ep.id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const filtering = !!query.trim() || mediaFilter !== "all" || practiceState !== "all" || duration !== "all";
  const filtered = episodes?.filter((ep) => {
    const count = ep.studied_count ?? ep.practiced_count;
    const state = ep.status !== "ready" ? "processing" : count === 0 && !ep.last_activity_at ? "new" : count >= ep.sentence_count ? "complete" : "started";
    const haystack = `${ep.title} ${ep.channel ?? ""}`.toLocaleLowerCase();
    return haystack.includes(query.trim().toLocaleLowerCase())
      && (mediaFilter === "all" || ep.source === mediaFilter)
      && (practiceState === "all" || state === practiceState)
      && (duration === "all" || (ep.status === "ready" && (
        duration === "short" ? ep.duration <= 300 : duration === "medium" ? ep.duration > 300 && ep.duration <= 1200 : ep.duration > 1200
      )));
  });

  return (
    <div className="space-y-10 sm:space-y-14">
      <TodayLearning episodes={episodes} review={review} />
      <ErrorBar message={error} onClose={() => setError(null)} />

      {health?.cloud ? (
        episodes?.length === 0 && <p className="text-sm text-muted">这台服务器不做导入：素材在 Mac 上导入。</p>
      ) : (
        <section id="add" className="scroll-mt-24 space-y-3" aria-label="添加素材">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">添加</h2>
            <Segmented label="素材来源" options={SOURCES} value={source} onChange={setSource} format={(k) => (k === "youtube" ? "YouTube" : "播客")} />
          </div>
          {source === "podcast" ? (
            <PodcastImport key={feedToOpen ?? ""} health={health} initialFeedUrl={feedToOpen} />
          ) : (
            <Composer
              value={url}
              onChange={setUrl}
              onSubmit={() => void importVideo()}
              busy={importing}
              disabled={importing}
              placeholder="粘贴 YouTube 视频或频道链接"
              label="YouTube 链接"
              submitLabel={CHANNEL_URL.test(url) ? "看频道" : "导入"}
            />
          )}
          {source === "youtube" && channelToOpen && (
            <ChannelVideos key={channelToOpen} url={channelToOpen} onClose={() => setChannelToOpen(null)} />
          )}
        </section>
      )}

      {!!episodes?.length && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">我的节目</h2>
            <Segmented label="显示方式" options={VIEWS} value={view} onChange={chooseView} format={(v) => (v === "shows" ? "按节目" : "全部")} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="field flex h-11 min-w-0 items-center gap-2.5 rounded-full px-4 sm:h-10 sm:flex-1">
              <IconSearch className="size-4 shrink-0 text-subtle" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="搜索我的素材"
                placeholder="搜索"
                className="min-w-0 flex-1 bg-transparent outline-none focus-visible:outline-none"
              />
            </label>
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
              <select aria-label="素材来源" value={mediaFilter} onChange={(e) => setMediaFilter(e.target.value)} className={SELECT}>
                <option value="all">全部来源</option><option value="youtube">YouTube</option><option value="podcast">播客</option>
              </select>
              <select aria-label="学习状态" value={practiceState} onChange={(e) => setPracticeState(e.target.value)} className={SELECT}>
                <option value="all">全部状态</option><option value="new">未开始</option><option value="started">学习中</option><option value="complete">学完一遍</option><option value="processing">处理中</option>
              </select>
              <select aria-label="素材时长" value={duration} onChange={(e) => setDuration(e.target.value)} className={SELECT}>
                <option value="all">全部时长</option><option value="short">5 分钟内</option><option value="medium">5–20 分钟</option><option value="long">20 分钟以上</option>
              </select>
            </div>
          </div>
          {filtering && <p className="px-1 text-sm text-muted">{filtered?.length ?? 0} 集</p>}
          {view === "shows" && !!filtered?.length && (
            <ShowList episodes={filtered} onMore={health?.cloud ? undefined : openMore} onRetry={retry} onRemove={remove} />
          )}
          <ul className={cx("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", view !== "all" && "hidden")}>
            {filtered?.map((ep) => {
              const studied = ep.studied_count ?? ep.practiced_count;
              const href = episodeHref(ep.id);
              return (
                <li key={ep.id} className="glass group overflow-hidden rounded-3xl p-2 transition-colors hover:bg-(--glass-strong)">
                  <Link href={href} tabIndex={-1} aria-hidden="true" className="relative block overflow-hidden rounded-2xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbnail(ep) ?? undefined} alt="" loading="lazy" className="aspect-video w-full bg-fill object-cover" />
                    {ep.source === "podcast" && (
                      <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">播客</span>
                    )}
                    {ep.status === "ready" && (
                      <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-md">
                        {formatTime(ep.duration)}
                      </span>
                    )}
                  </Link>
                  <div className="flex items-start gap-1 px-2 pb-1.5 pt-3">
                    <Link href={href} className="min-w-0 flex-1 space-y-2">
                      <div className="line-clamp-2 font-medium leading-snug">{ep.title}</div>
                      {ep.status === "ready" ? (
                        <div className="flex items-center gap-2">
                          <Progress value={studied / Math.max(ep.sentence_count, 1)} label="学习进度" className="flex-1" />
                          <span className="text-xs tabular-nums text-subtle">
                            {studied}/{ep.sentence_count}
                          </span>
                        </div>
                      ) : (
                        <div className={cx("text-sm", ep.status === "failed" ? "text-bad" : "text-muted")}>
                          {ep.status === "failed" ? "处理失败：" : "处理中："}
                          {ep.status_detail}
                        </div>
                      )}
                    </Link>
                    <div className="-mr-1 -mt-1 flex shrink-0 items-center">
                      {ep.status === "failed" && (
                        <button onClick={() => retry(ep)} className="rounded-full px-2.5 py-1.5 text-xs font-medium hover:bg-fill">
                          重试
                        </button>
                      )}
                      <button
                        onClick={() => remove(ep)}
                        aria-label={`删除「${ep.title}」`}
                        title="删除"
                        className="grid size-8 place-items-center rounded-full text-subtle transition hover:bg-fill hover:text-bad pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
                      >
                        <IconTrash className="size-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {filtered?.length === 0 && <p className="py-10 text-center text-sm text-muted">没有符合条件的素材。</p>}
        </section>
      )}
    </div>
  );
}

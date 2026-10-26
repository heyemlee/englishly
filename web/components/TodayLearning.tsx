import Link from "next/link";
import { episodeHref, thumbnail, type EpisodeSummary, type ReviewSummary } from "@/lib/api";
import { IconArrowRight, IconChevronRight, IconTarget } from "@/components/icons";
import { Progress } from "@/components/ui";

const TILE = "glass flex min-h-32 flex-col justify-between gap-5 rounded-3xl p-5 transition-colors hover:bg-(--glass-strong)";

export default function TodayLearning({ episodes, review }: { episodes: EpisodeSummary[] | null; review: ReviewSummary | null }) {
  const ready = (episodes ?? []).filter((ep) => ep.status === "ready");
  const recent = [...ready].filter((ep) => ep.last_activity_at).sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""));
  const next = recent.find((ep) => ep.studied_count < ep.sentence_count) ?? ready.find((ep) => !ep.studied_count) ?? recent[0] ?? ready[0];
  const studied = next ? (next.studied_count ?? next.practiced_count) : 0;
  return (
    <section className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" aria-label="今天的学习">
      {next ? (
        <Link
          href={episodeHref(next.id, next.last_sentence_idx)}
          className="glass group grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-4 rounded-3xl p-3 transition-colors hover:bg-(--glass-strong) sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-x-6 sm:p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnail(next) ?? undefined} alt="" className="aspect-video w-full rounded-2xl bg-fill object-cover sm:row-span-2" />
          <div className="min-w-0 space-y-1 sm:self-end">
            <p className="text-[13px] text-muted">{next.last_activity_at ? "继续上次" : "开始新的一集"}</p>
            <h1 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight sm:text-2xl">{next.title}</h1>
            {next.channel && <p className="hidden truncate text-sm text-muted sm:block">{next.channel}</p>}
          </div>
          <div className="col-span-2 flex items-center gap-3 px-1 pb-1 sm:col-span-1 sm:self-start sm:p-0">
            <Progress value={studied / Math.max(next.sentence_count, 1)} label="这一集的进度" className="flex-1" />
            <span className="text-xs tabular-nums text-muted">
              {studied}/{next.sentence_count}
            </span>
            <span className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-transform group-active:scale-[0.97]">
              {next.last_activity_at ? "继续" : "开始"}
              <IconArrowRight className="size-4" />
            </span>
          </div>
        </Link>
      ) : (
        <div className="glass flex min-h-40 flex-col justify-end rounded-3xl p-6 sm:p-8">
          {episodes !== null && (
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">从一段喜欢的英文开始</h1>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <Link href="/review" className={TILE}>
          <span className="flex items-center justify-between text-sm font-medium">
            复习
            <IconChevronRight className="size-4 text-subtle" />
          </span>
          <span className="flex items-baseline gap-1">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">{review ? review.due + review.new_available : "–"}</span>
            <span className="text-sm text-muted">张</span>
          </span>
        </Link>
        <Link href="/practice/mishears" className={TILE}>
          <span className="flex items-center justify-between text-sm font-medium">
            误听重练
            <IconChevronRight className="size-4 text-subtle" />
          </span>
          <IconTarget className="size-9" />
        </Link>
      </div>
    </section>
  );
}

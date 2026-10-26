"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, episodeHref, type Mishears, type Stats } from "@/lib/api";
import { ColumnChart, Dumbbells, PercentLines } from "@/components/charts";
import { IconArrowRight, IconChevronDown } from "@/components/icons";
import { Card, cx, ErrorBar, PageTitle, Progress, Segmented, Spinner } from "@/components/ui";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const TABS = ["progress", "mishears"] as const;

function Delta({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) return <span className="text-xs text-subtle">上周无数据</span>;
  const d = Math.round((now - before) * 100);
  if (d === 0) return <span className="text-xs text-muted">与上周持平</span>;
  return (
    <span className={cx("text-xs font-medium", d > 0 ? "text-good" : "text-bad")}>
      {d > 0 ? "▲" : "▼"} 比上周{d > 0 ? "高" : "低"} {Math.abs(d)} 分
    </span>
  );
}

function Tile({ label, value, children }: { label: string; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="glass flex flex-col gap-1 rounded-3xl p-5">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      {children}
    </div>
  );
}

export default function StatsPage() {
  const [tab, setTab] = useState<"progress" | "mishears">("progress");
  const [stats, setStats] = useState<Stats | null>(null);
  const [mishears, setMishears] = useState<Mishears | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch((e: Error) => setError(e.message));
    api.mishears().then(setMishears).catch((e: Error) => setError(e.message));
  }, []);

  const loading = <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> 加载中</p>;
  return (
    <div className="space-y-6">
      <PageTitle
        title="数据"
        action={<Segmented label="查看" options={TABS} value={tab} onChange={setTab} format={(t) => (t === "progress" ? "进度" : "误听本")} />}
      />
      <ErrorBar message={error} onClose={() => setError(null)} />
      {tab === "progress" ? (
        stats ? <ProgressView stats={stats} /> : !error && loading
      ) : mishears ? (
        <MishearBook data={mishears} />
      ) : (
        !error && loading
      )}
    </div>
  );
}

function ProgressView({ stats }: { stats: Stats }) {
  const t = stats.totals;
  const labels = stats.daily.map((d) => d.date);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="col-span-2 flex flex-col gap-1 rounded-3xl bg-foreground p-5 text-background shadow-[0_18px_44px_-16px_rgba(0,0,0,0.45)] lg:col-span-1">
          <div className="text-[13px] opacity-70">连续练习</div>
          <div className="text-5xl font-semibold tracking-tight tabular-nums">
            {stats.streak}
            <span className="ml-1.5 text-base font-normal opacity-70">天</span>
          </div>
          <div className="text-xs opacity-70">一共练了 {stats.active_days} 天</div>
        </div>
        <Tile label="练过的句子" value={t.sentences_practiced}>
          <div className="text-xs text-muted">听写 {t.dictations} · 跟读 {t.shadows}</div>
        </Tile>
        <Tile label="实际收听" value={<>{Math.round((t.listening_seconds ?? 0) / 60)}<span className="ml-1 text-base font-normal text-muted">分钟</span></>}>
          <p className="text-xs text-muted" title="每句覆盖八成原声才算听过">听过 {t.sentences_heard ?? 0} 句</p>
        </Tile>
        <Tile label="听写正确率 · 近 7 天" value={pct(stats.recent.dictation)}>
          <Delta now={stats.recent.dictation} before={stats.recent.dictation_prev} />
        </Tile>
        <Tile label="跟读得分 · 近 7 天" value={pct(stats.recent.shadow)}>
          <Delta now={stats.recent.shadow} before={stats.recent.shadow_prev} />
        </Tile>
        <Tile
          label="记住的表达"
          value={
            <>
              {t.cards_mature}
              <span className="text-base font-normal text-muted"> / {t.cards}</span>
            </>
          }
        >
          <Progress value={t.cards ? t.cards_mature / t.cards : 0} label="记住的表达" className="my-1" />
          <div className="text-xs text-muted" title="记忆能保持 3 周以上算记住">
            学习中 {t.cards_learning} · 新卡 {t.cards_new}
          </div>
        </Tile>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-sm font-medium">每天练的句子 <span className="font-normal text-subtle">· 近 30 天</span></h2>
          <ColumnChart data={stats.daily.map((d) => ({ label: d.date, value: d.sentences }))} unit="句" />
        </Card>
        <Card className="space-y-3">
          <h2 className="text-sm font-medium">听写、跟读的每日平均分</h2>
          <PercentLines
            labels={labels}
            series={[
              { name: "听写", color: "var(--series-1)", values: stats.daily.map((d) => d.dictation_avg) },
              { name: "跟读", color: "var(--series-2)", values: stats.daily.map((d) => d.shadow_avg) },
            ]}
          />
        </Card>
        <Card className="space-y-3">
          <h2 className="text-sm font-medium">每天复习次数</h2>
          <ColumnChart data={stats.daily.map((d) => ({ label: d.date, value: d.reviews }))} unit="次" />
        </Card>
        <Card className="space-y-3">
          <h2 className="text-sm font-medium">复述语速 <span className="font-normal text-subtle">· 第一遍 → 最后一遍，词/分钟</span></h2>
          {stats.retells.length ? (
            <Dumbbells
              unit="词/分钟"
              rows={stats.retells
                .slice(-8)
                .reverse()
                .map((r) => ({
                  label: `${r.created_at.slice(5, 10)} · ${r.title ?? "复述"}`,
                  from: r.wpm[0],
                  to: r.wpm[r.wpm.length - 1],
                }))}
            />
          ) : (
            <p className="text-sm text-muted">
              还没有记录。
              <Link href="/retell" className="font-medium text-foreground underline underline-offset-4">去复述</Link>
            </p>
          )}
        </Card>
      </div>

      <p className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-sm text-muted">
        <span>节目 {t.episodes}</span>
        <span>复习 {t.reviews} 次</span>
        <span>复述 {t.retells} 次</span>
      </p>

      <details className="group">
        <summary className="inline-flex cursor-pointer items-center gap-1 px-1 text-sm text-muted transition-colors hover:text-foreground">
          每天的数据
          <IconChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="glass mt-3 overflow-x-auto rounded-3xl">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="text-muted">
              <tr>
                {["日期", "练的句子", "听写次数", "听写平均", "跟读次数", "跟读平均", "复习"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...stats.daily].reverse().map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="whitespace-nowrap px-4 py-2">{d.date}</td>
                  <td className="px-4 py-2">{d.sentences}</td>
                  <td className="px-4 py-2">{d.dictation}</td>
                  <td className="px-4 py-2">{pct(d.dictation_avg)}</td>
                  <td className="px-4 py-2">{d.shadow}</td>
                  <td className="px-4 py-2">{pct(d.shadow_avg)}</td>
                  <td className="px-4 py-2">{d.reviews}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function MishearBook({ data }: { data: Mishears }) {
  if (!data.total) {
    return <Card pad="roomy" className="text-center text-muted">还没有记录。做几句听写后会出现在这里。</Card>;
  }
  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-[13px] text-muted">{data.attempts} 次听写里</p>
          <p className="text-4xl font-semibold tracking-tight tabular-nums">
            {data.total}
            <span className="ml-1.5 text-base font-normal text-muted">处漏听或听错</span>
          </p>
          {data.function_share !== null && (
            <p className="text-sm text-muted" title="虚词在快速说话时常被弱读、和前后的词连在一起">
              其中 <b className="font-semibold text-foreground">{Math.round(data.function_share * 100)}%</b> 是 to、the、and 这类虚词
            </p>
          )}
        </div>
        <Link
          href="/practice/mishears"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-85"
        >
          重练 10 句 <IconArrowRight className="size-4" />
        </Link>
      </Card>

      <Card pad="none">
        <h2 className="px-5 pb-2 pt-5 text-sm font-medium sm:px-6">最常听错的词</h2>
        <ul className="divide-y divide-border">
          {data.top.map((w) => (
            <li key={w.word} className="space-y-1.5 px-5 py-3.5 text-sm sm:px-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-base font-semibold">{w.word}</span>
                <span className="text-xs tabular-nums text-muted">
                  {w.count} 次{w.missed ? ` · 漏听 ${w.missed}` : ""}
                </span>
                {w.function_word && <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-muted">虚词</span>}
                <Link
                  href={`/practice/mishears?word=${encodeURIComponent(w.word)}`}
                  className="ml-auto inline-flex h-8 items-center gap-1 rounded-full bg-fill px-3.5 text-xs font-medium transition-colors hover:bg-fill-strong"
                >
                  专项重练
                </Link>
              </div>
              {w.heard_as.length > 0 && (
                <p className="text-xs text-muted">
                  听成了 {w.heard_as.map((h) => `「${h.text}」${h.count > 1 ? `×${h.count}` : ""}`).join(" ")}
                </p>
              )}
              <ul className="space-y-0.5 text-xs text-muted">
                {w.examples.map((ex, i) => (
                  <li key={i}>
                    <Link href={episodeHref(ex.episode_id, ex.sentence_idx)} className="hover:text-foreground">
                      “{ex.sentence}”
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium">最近的听写错误</h2>
        <ul className="space-y-2 text-sm">
          {data.recent.map((r, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2">
              <b className="font-semibold">{r.expected}</b>
              <span className="text-muted">{r.got ? <>听成了 <span className="text-bad">{r.got}</span></> : "没听出来"}</span>
              <Link href={episodeHref(r.episode_id, r.sentence_idx)} className="min-w-0 truncate text-xs text-subtle hover:text-foreground">
                “{r.sentence}”
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

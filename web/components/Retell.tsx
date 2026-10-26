"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api, episodeHref, formatTime, loadPref, savePref, type EpisodeDetail, type Retell as RetellSession, type RetellRound } from "@/lib/api";
import { dateText } from "@/lib/time";
import { useRecorder } from "@/lib/useRecorder";
import { IconChevronDown, IconMic, IconReplay, IconStop } from "@/components/icons";
import { Btn, Card, cx, ErrorBar, PageTitle, preventFocus, Segmented, Spinner, Toggle } from "@/components/ui";

const PRESETS = [
  { label: "入门", limits: [120, 90, 60] },
  { label: "进阶", limits: [180, 120, 90] },
  { label: "标准", limits: [240, 180, 120] },
];
const PRESET_INDEXES = PRESETS.map((_, i) => i);
const TOPICS = ["介绍你现在的工作", "说说你上个周末做了什么", "推荐一个你常去的地方", "讲一件最近让你开心的事"];
const CHIP = "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-fill px-3.5 text-[13px] font-medium transition-colors hover:bg-fill-strong";

type Phase = "setup" | "recording" | "between" | "done";

const presetText = (limits: number[]) => limits.map((s) => s / 60).join(" → ") + " 分钟";

export default function Retell() {
  const search = useSearchParams();
  const episodeParam = search.get("episode");
  const clipParam = search.get("clip");
  const episodeId = episodeParam ? Number(episodeParam) : null;
  const clip = clipParam ? Number(clipParam) : null;

  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [topic, setTopic] = useState("");
  const [preset, setPreset] = useState(() => loadPref("retell.preset", 0));
  const [showLive, setShowLive] = useState(() => loadPref("retell.showLive", false));
  const [peek, setPeek] = useState(false);
  const [phase, setPhase] = useState<Phase>("setup");
  const [rounds, setRounds] = useState<RetellRound[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<RetellSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const rec = useRecorder({ levels: true });
  const timerRef = useRef<number | null>(null);
  const finishing = useRef(false);

  const limits = PRESETS[preset]?.limits ?? PRESETS[0].limits;
  const clipSentences = episode?.sentences.filter((s) => clip === null || s.clip === clip) ?? [];
  const subjectReady = episodeId !== null ? !!episode : !!topic.trim();

  useEffect(() => {
    if (episodeId !== null) api.episode(episodeId).then(setEpisode).catch((e: Error) => setError(e.message));
    api.retells().then(setHistory).catch(() => setHistory([]));
  }, [episodeId]);
  useEffect(() => {
    savePref("retell.preset", preset);
    savePref("retell.showLive", showLive);
  }, [preset, showLive]);
  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  const finishRound = async () => {
    if (finishing.current) return;
    finishing.current = true;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    const r = await rec.stop();
    finishing.current = false;
    if (!r) return;
    const words = r.transcript.split(/\s+/).filter(Boolean).length;
    const round: RetellRound = {
      limit_seconds: limits[rounds.length],
      total_seconds: Math.round(r.seconds * 10) / 10,
      speaking_seconds: r.speakingSeconds === null ? null : Math.round(r.speakingSeconds * 10) / 10,
      transcript: r.transcript,
      words,
      wpm: r.seconds > 0 ? Math.round((words / r.seconds) * 60) : 0,
      pauses: r.pauses.length,
      longest_pause: Math.round(Math.max(0, ...r.pauses) * 10) / 10,
    };
    if (!r.transcript && r.recognitionError) setError(r.recognitionError);
    const next = [...rounds, round];
    setRounds(next);
    if (next.length < 3) {
      setPhase("between");
      return;
    }
    setPhase("done");
    try {
      const session = await api.saveRetell({
        episode_id: episodeId,
        clip_idx: clip,
        topic: episodeId === null ? topic.trim() : "",
        rounds: next,
      });
      setHistory((h) => [session, ...h]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startRound = async () => {
    setError(null);
    try {
      await rec.start();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const limit = limits[rounds.length];
    const startedAt = performance.now();
    setElapsed(0);
    setPhase("recording");
    timerRef.current = window.setInterval(() => {
      const s = (performance.now() - startedAt) / 1000;
      setElapsed(s);
      if (s >= limit) void finishRound();
    }, 200);
  };

  const restart = () => {
    setRounds([]);
    setPhase("setup");
  };

  const limit = limits[Math.min(rounds.length, 2)];
  const remaining = Math.max(0, limit - elapsed);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageTitle title="4/3/2 复述" />

      <Card className="space-y-5">
        {episodeId !== null ? (
          episode ? (
            <div className="space-y-3">
              <div>
                <p className="text-[13px] text-muted">复述这段</p>
                <p className="mt-0.5 font-semibold leading-snug">
                  {episode.title}
                  {clip !== null && <span className="font-normal text-muted"> · 片段 {clip + 1}</span>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={episodeHref(episode.id, clipSentences[0]?.idx ?? 0)} className={CHIP}>
                  <IconReplay className="size-3.5" /> 回去再听
                </Link>
                <button type="button" onMouseDown={preventFocus} onClick={() => setPeek((v) => !v)} aria-expanded={peek} className={CHIP}>
                  偷看原文
                  <IconChevronDown className={cx("size-3.5 transition-transform", peek && "rotate-180")} />
                </button>
              </div>
              {peek && (
                <p className="max-h-48 overflow-y-auto rounded-2xl bg-fill p-4 text-sm leading-relaxed text-muted">
                  {clipSentences.map((s) => s.text).join(" ")}
                </p>
              )}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> 加载中</p>
          )
        ) : (
          <div className="space-y-3">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={phase !== "setup"}
              placeholder="说一个话题"
              aria-label="话题"
              className="field h-12 w-full rounded-full px-5"
            />
            {phase === "setup" && (
              <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0">
                {TOPICS.map((t) => (
                  <button key={t} type="button" onMouseDown={preventFocus} onClick={() => setTopic(t)} className={cx(CHIP, "font-normal text-muted hover:text-foreground")}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Segmented
            label="每遍限时"
            options={PRESET_INDEXES}
            value={preset}
            onChange={setPreset}
            format={(i) => PRESETS[i].label}
            disabled={phase !== "setup"}
          />
          <span className="text-[13px] tabular-nums text-muted">{presetText(limits)}</span>
        </div>
      </Card>

      <ErrorBar message={error} onClose={() => setError(null)} />

      {phase !== "done" && (
        <Card pad="roomy" className="space-y-6 text-center">
          <div className="flex items-center justify-center gap-1.5" aria-label={`第 ${rounds.length + 1} / 3 遍`}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cx("h-1.5 w-8 rounded-full", i < rounds.length ? "bg-foreground" : i === rounds.length ? "bg-foreground/35" : "bg-fill-strong")}
              />
            ))}
          </div>
          <p className="text-sm text-muted">第 {rounds.length + 1} / 3 遍</p>
          <div
            className={cx(
              "text-7xl font-light tracking-tight tabular-nums",
              phase !== "recording" && "text-subtle",
              phase === "recording" && remaining < 10 && "text-bad",
            )}
          >
            {formatTime(phase === "recording" ? Math.ceil(remaining) : limit)}
          </div>
          {phase === "recording" ? (
            <>
              {showLive && <p className="mx-auto min-h-6 max-w-md text-left text-sm text-muted">{rec.interim || "…"}</p>}
              <Btn danger large onClick={() => void finishRound()}>
                <IconStop className="size-3.5" /> 说完了
              </Btn>
            </>
          ) : (
            <>
              {phase === "between" && <RoundStats round={rounds[rounds.length - 1]} />}
              <Btn primary large onClick={() => void startRound()} disabled={!subjectReady}>
                <IconMic className="size-4" /> 开始第 {rounds.length + 1} 遍
              </Btn>
            </>
          )}
          <div className="flex justify-center">
            <Toggle checked={showLive} onChange={setShowLive} title="说的时候显示识别出的文字">
              显示识别文字
            </Toggle>
          </div>
        </Card>
      )}

      {phase === "done" && (
        <Card className="space-y-5">
          <h2 className="text-lg font-semibold tracking-tight">三遍对比</h2>
          <Comparison rounds={rounds} />
          <Btn primary onClick={restart}>
            <IconReplay className="size-4" /> 再练一次
          </Btn>
        </Card>
      )}

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 text-sm font-medium text-muted">以前的复述</h2>
          <ul className="glass divide-y divide-border overflow-hidden rounded-3xl text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0 truncate">
                  {h.title ? `${h.title}${h.clip_idx !== null ? ` · 片段 ${h.clip_idx + 1}` : ""}` : h.topic}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {dateText(h.created_at)} · {h.rounds.map((r) => r.wpm).join(" → ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RoundStats({ round }: { round: RetellRound }) {
  const stats: [string, React.ReactNode, string?][] = [
    ["时长", formatTime(round.total_seconds)],
    ["词数", round.words],
    ["词/分", round.wpm],
    ["停顿", round.pauses, "1 秒以上的停顿"],
  ];
  return (
    <div className="space-y-4">
      <div className="mx-auto grid max-w-sm grid-cols-4 gap-2">
        {stats.map(([label, value, title]) => (
          <div key={label} title={title} className="rounded-2xl bg-fill px-2 py-2.5">
            <div className="text-lg font-semibold tabular-nums">{value}</div>
            <div className="text-[11px] text-muted">{label}</div>
          </div>
        ))}
      </div>
      {round.transcript && <p className="mx-auto max-w-xl text-left text-xs leading-relaxed text-muted">{round.transcript}</p>}
    </div>
  );
}

function Comparison({ rounds }: { rounds: RetellRound[] }) {
  const maxWpm = Math.max(1, ...rounds.map((r) => r.wpm));
  const rows: [string, (r: RetellRound) => React.ReactNode][] = [
    ["限时", (r) => formatTime(r.limit_seconds)],
    ["实际说了", (r) => formatTime(r.total_seconds)],
    ["词数", (r) => r.words],
    [
      "语速（词/分钟）",
      (r) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 rounded-full bg-foreground" style={{ width: `${(r.wpm / maxWpm) * 56}px` }} />
          <b className="font-semibold">{r.wpm}</b>
        </div>
      ),
    ],
    ["1 秒以上停顿", (r) => r.pauses],
    ["最长停顿", (r) => `${r.longest_pause} 秒`],
  ];
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 font-normal" />
              {rounds.map((_, i) => (
                <th key={i} className="py-1.5 font-normal">
                  第 {i + 1} 遍
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cell]) => (
              <tr key={label} className="border-t border-border">
                <td className="whitespace-nowrap py-2 pr-3 text-muted">{label}</td>
                {rounds.map((r, i) => (
                  <td key={i} className="py-2 tabular-nums">
                    {cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="group text-sm">
        <summary className="inline-flex cursor-pointer items-center gap-1 text-muted transition-colors hover:text-foreground">
          三遍的识别文字
          <IconChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-muted">
          {rounds.map((r, i) => (
            <li key={i}>{r.transcript || "（没识别到内容）"}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}

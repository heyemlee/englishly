"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, mediaUrl, type MishearQuestion } from "@/lib/api";
import { diffWords, type WordDiff } from "@/lib/diff";
import { useAudioPlayer } from "@/lib/useAudioPlayer";
import { useYouTubePlayer } from "@/lib/useYouTubePlayer";
import { IconArrowRight, IconChevronLeft, IconReplay } from "@/components/icons";
import { Btn, Card, DiffView, ErrorBar, PageTitle, Progress, Score, Spinner } from "@/components/ui";

type Result = { question: MishearQuestion; score: number | null };

const BACK = "-my-2 inline-flex items-center gap-1 py-2 pr-3 text-sm text-muted transition-colors hover:text-foreground";

export default function MishearDrill() {
  const word = useSearchParams().get("word") ?? "";
  const [items, setItems] = useState<MishearQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.mishearPractice(word).then((r) => { if (alive) setItems(r.items); }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [word]);
  if (error) return <ErrorBar message={error} />;
  if (!items) return <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> 正在准备</p>;
  if (!items.length) return <div className="mx-auto max-w-2xl space-y-6">
    <Link href="/" className={BACK}><IconChevronLeft className="size-4" /> 我的节目</Link>
    <Card pad="roomy" className="space-y-2 text-center">
      <h1 className="text-xl font-semibold tracking-tight">没有要重练的句子</h1>
      <p className="text-sm text-muted">{word ? `含「${word}」的句子都已经练对了。` : "听写里还有错的句子会出现在这里。"}</p>
    </Card>
  </div>;
  return <DrillSession key={word} questions={items} word={word} />;
}

function DrillSession({ questions, word }: { questions: MishearQuestion[]; word: string }) {
  const [results, setResults] = useState<Result[]>([]);
  const answered = results.filter((r) => r.score !== null);
  if (results.length === questions.length) {
    const before = answered.length ? answered.reduce((sum, r) => sum + r.question.before_score, 0) / answered.length : null;
    const after = answered.length ? answered.reduce((sum, r) => sum + (r.score ?? 0), 0) / answered.length : null;
    return <div className="mx-auto max-w-2xl space-y-6">
      <PageTitle title="这组练完了" subtitle={`完成 ${answered.length} 句 · 跳过 ${results.length - answered.length} 句`} />
      {before !== null && after !== null && <div className="grid grid-cols-3 gap-3 text-center">
        {[["重练前", `${Math.round(before * 100)}%`], ["这一次", `${Math.round(after * 100)}%`], ["变化", `${after >= before ? "+" : ""}${Math.round((after - before) * 100)} 分`]].map(([label, value]) => (
          <div key={label} className="glass rounded-3xl p-4">
            <p className="text-[13px] text-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          </div>
        ))}
      </div>}
      <Link href="/" className="inline-flex h-10 items-center rounded-full bg-foreground px-5 text-sm font-medium text-background">我的节目</Link>
    </div>;
  }
  return <div className="mx-auto max-w-2xl space-y-6">
    <Link href="/" className={BACK}><IconChevronLeft className="size-4" /> 我的节目</Link>
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl">{word ? `「${word}」专项重练` : "误听重练"}</h1>
        <span className="pb-1 text-sm tabular-nums text-muted">{results.length + 1} / {questions.length}</span>
      </div>
      <Progress value={results.length / questions.length} label="进度" />
    </div>
    <Question key={questions[results.length].sentence_id} question={questions[results.length]}
      onDone={(score) => setResults((all) => [...all, { question: questions[all.length], score }])} />
  </div>;
}

function Question({ question: q, onDone }: { question: MishearQuestion; onDone: (score: number | null) => void }) {
  const useAudio = q.has_audio;
  const { containerRef, ...video } = useYouTubePlayer(useAudio ? null : q.video_id);
  const { audioRef, ...audio } = useAudioPlayer(useAudio ? mediaUrl(q.episode_id) : null);
  const player = useAudio ? audio : video;
  const [input, setInput] = useState("");
  const [diff, setDiff] = useState<WordDiff | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);
  const play = () => player.playRange(Math.max(0, q.start_s - 0.1), q.end_s + 0.25, { loops: 1 });
  const finish = (score: number | null) => {
    if (finished.current) return;
    finished.current = true;
    player.stop();
    onDone(score);
  };
  const check = async () => {
    if (!input.trim() || busy) return;
    const result = diff ?? diffWords(q.text, input);
    setDiff(result);
    setBusy(true);
    setError(null);
    try {
      await api.saveAttempt({ sentence_id: q.sentence_id, kind: "dictation", user_text: input, score: result.score,
        details: { missed: result.missed, wrong: result.wrong } });
      setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Card className="space-y-5">
    <p className="truncate text-[13px] text-muted">{q.title} · 第 {q.sentence_idx + 1} 句</p>
    {useAudio ? <audio ref={audioRef} src={mediaUrl(q.episode_id)} controls className="w-full" />
      : <div ref={containerRef} className="aspect-video overflow-hidden rounded-2xl bg-black" />}
    <div className="flex items-center gap-3">
      <Btn primary onClick={play} disabled={!player.ready}>
        {player.ready ? <><IconReplay className="size-4" /> 听原句</> : <><Spinner /> 加载中</>}
      </Btn>
      <span className="text-[13px] tabular-nums text-muted">上次 {Math.round(q.before_score * 100)}%</span>
    </div>
    <input aria-label="听写" value={input} onChange={(e) => setInput(e.target.value)} readOnly={!!diff}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (saved) finish(diff!.score); else void check(); } }}
      placeholder="听到什么就打什么" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
      className="field w-full rounded-2xl px-4 py-3 text-lg sm:text-lg" />
    {diff && <div className="space-y-3"><Score score={diff.score} label="这次" /><DiffView diff={diff} userLabel="你写的" wrongVerb="听成了" /></div>}
    <ErrorBar message={error ?? player.error} />
    <div className="flex gap-2">{saved ? <Btn primary onClick={() => finish(diff!.score)}>下一句 <IconArrowRight className="size-4" /></Btn>
      : <Btn primary onClick={() => void check()} disabled={busy || !input.trim()}>{busy ? "保存中…" : diff ? "重试保存" : "检查"}</Btn>}
      <Btn onClick={() => finish(null)} disabled={busy || saved}>跳过</Btn>
    </div>
  </Card>;
}

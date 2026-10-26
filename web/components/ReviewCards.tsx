"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { episodeHref, mediaUrl, type CardKind, type ReviewCard } from "@/lib/api";
import { diffWords, type WordDiff } from "@/lib/diff";
import { speak } from "@/lib/tts";
import { useAudioPlayer } from "@/lib/useAudioPlayer";
import { usePref } from "@/lib/usePref";
import { useRecorder } from "@/lib/useRecorder";
import { useYouTubePlayer } from "@/lib/useYouTubePlayer";
import { IconMic, IconReplay, IconSpeaker, IconStop } from "@/components/icons";
import { Btn, Card, cx, DiffView, ErrorBar, Score, Spinner, Toggle } from "@/components/ui";

export const KIND_LABEL: Record<CardKind, string> = {
  produce: "看中文说英文",
  listen: "听音辨义",
  cloze: "填空",
};

const RATINGS = [
  { value: 1, label: "重来" },
  { value: 2, label: "困难" },
  { value: 3, label: "记得" },
  { value: 4, label: "简单" },
] as const;

const SOURCE_LABEL: Record<string, string> = {
  chunk: "收藏的表达",
  // cards made by older versions
  phrase: "我想说",
  talk: "对话点评",
  retell: "复述点评",
  manual: "手动添加",
};

const ANSWER_INPUT = "field h-12 w-full rounded-full px-5";

export type RateFn = (card: ReviewCard, rating: number, said: string, score: number | null) => Promise<void>;

/** Window key handler that always sees the latest state. Ignores keys typed into text fields. */
function useKeys(handler: (key: string, e: KeyboardEvent) => boolean) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (ref.current(e.key.toLowerCase(), e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function scoreToRating(score: number) {
  return score >= 0.9 ? 3 : score >= 0.6 ? 2 : 1;
}

function RatingButtons({ card, suggested, busy, onRate }: { card: ReviewCard; suggested: number | null; busy: boolean; onRate: (r: number) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {RATINGS.map((r) => (
        <button
          key={r.value}
          onClick={() => onRate(r.value)}
          disabled={busy}
          title={`${r.label}（${r.value}）`}
          className={cx(
            "rounded-2xl px-1 py-3 transition-[background-color,transform] active:scale-[0.97] disabled:opacity-50",
            suggested === r.value ? "bg-foreground text-background" : "bg-fill hover:bg-fill-strong",
          )}
        >
          <div className="text-sm font-medium">{r.label}</div>
          <div className={cx("mt-0.5 text-xs tabular-nums", suggested === r.value ? "opacity-70" : "text-muted")}>
            {card.intervals[String(r.value) as "1"]}后
          </div>
        </button>
      ))}
    </div>
  );
}

function Shell({ card, children, footer }: { card: ReviewCard; children: ReactNode; footer?: ReactNode }) {
  const origin = card.origin;
  const source = origin && "sentence" in origin && origin.sentence && origin.episode_id !== null ? origin : null;
  return (
    <Card pad="large" className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {card.is_new && <span className="rounded-full bg-foreground px-2 py-0.5 font-medium text-background">新卡</span>}
        <span className="font-medium">{KIND_LABEL[card.kind]}</span>
        <span className="text-subtle">{SOURCE_LABEL[card.source] ?? card.source}</span>
      </div>
      {children}
      {(source || footer) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted">
          {source ? (
            <Link href={episodeHref(source.episode_id!, source.sentence_idx ?? 0)} className="line-clamp-2 min-w-0 flex-1 hover:text-foreground">
              出自 “{source.sentence}”
            </Link>
          ) : <span />}
          {footer}
        </div>
      )}
    </Card>
  );
}

function SpeakAnswer({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-2xl font-semibold leading-snug tracking-tight">{text}</span>
      <button
        onClick={() => void speak(text)}
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-fill hover:text-foreground"
        title="朗读（P）"
        aria-label="朗读"
      >
        <IconSpeaker className="size-[18px]" />
      </button>
    </div>
  );
}

export function CardView({ card, onRate }: { card: ReviewCard; onRate: RateFn }) {
  if (card.kind === "listen") return <ListenCard card={card} onRate={onRate} />;
  if (card.kind === "cloze") return <ClozeCard card={card} onRate={onRate} />;
  return <ProduceCard card={card} onRate={onRate} />;
}

/** See the Chinese, say (or type) the English. */
function ProduceCard({ card, onRate }: { card: ReviewCard; onRate: RateFn }) {
  const rec = useRecorder();
  const [said, setSaid] = useState("");
  const [typed, setTyped] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = usePref<boolean>("review.autoSpeak", true);

  const diff = said ? diffWords(card.answer_en, said) : null;
  const suggested = diff ? scoreToRating(diff.score) : null;

  useEffect(() => {
    if (revealed && autoSpeak) void speak(card.answer_en);
  }, [revealed, autoSpeak, card.answer_en]);

  const toggleMic = async () => {
    if (rec.recording) {
      const r = await rec.stop();
      if (r?.transcript) {
        setSaid(r.transcript);
        setRevealed(true);
      } else {
        setError(r?.recognitionError ?? "没听到你说的话，再试一次，或者直接打字。");
      }
      return;
    }
    setError(null);
    try {
      await rec.start();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submitTyped = () => {
    if (!typed.trim()) return;
    setSaid(typed.trim());
    setRevealed(true);
  };

  const rate = async (rating: number) => {
    if (busy) return;
    setBusy(true);
    await onRate(card, rating, said, diff ? diff.score : null);
  };

  useKeys((key) => {
    if (key === "r" && !revealed) void toggleMic();
    else if (key === " " && !revealed && !rec.recording) setRevealed(true);
    else if (key === "h") setShowHint(true);
    else if (key === "p") void speak(card.answer_en);
    else if (revealed && ["1", "2", "3", "4"].includes(key)) void rate(Number(key));
    else return false;
    return true;
  });

  return (
    <Shell
      card={card}
      footer={
        <Toggle checked={autoSpeak} onChange={setAutoSpeak} title="显示答案时朗读">
          自动朗读
        </Toggle>
      }
    >
      <p className="text-[26px] font-medium leading-snug tracking-tight sm:text-3xl">{card.prompt_zh}</p>
      {card.hint && (
        showHint || revealed ? (
          <p className="text-sm text-muted">
            提示 <span className="ml-1 font-medium text-foreground">{card.hint}</span>
          </p>
        ) : (
          <button onClick={() => setShowHint(true)} title="提示（H）" className="-my-2 py-2 pr-3 text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-foreground">
            提示
          </button>
        )
      )}

      {!revealed ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Btn primary={!rec.recording} danger={rec.recording} onClick={() => void toggleMic()} title="说（R）">
              {rec.recording ? <><IconStop className="size-3.5" /> 说完了</> : <><IconMic className="size-4" /> 用英文说</>}
            </Btn>
            <Btn onClick={() => setRevealed(true)} title="看答案（空格）">
              看答案
            </Btn>
          </div>
          {rec.recording && <p className="text-muted">{rec.interim || "…"}</p>}
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) submitTyped();
            }}
            placeholder="也可以打字回答"
            aria-label="打字回答"
            className={ANSWER_INPUT}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="space-y-5">
          <SpeakAnswer text={card.answer_en} />
          {diff && (
            <div className="space-y-3">
              <Score score={diff.score} label="和参考答案重合" />
              <DiffView diff={diff} userLabel="你说的" wrongVerb="说成了" />
            </div>
          )}
          <RatingButtons card={card} suggested={suggested} busy={busy} onRate={(r) => void rate(r)} />
        </div>
      )}
      <ErrorBar message={error} onClose={() => setError(null)} />
    </Shell>
  );
}

/** Hear the English (the original recording when the card came from a video or podcast), get the meaning. */
function ListenCard({ card, onRate }: { card: ReviewCard; onRate: RateFn }) {
  const l = card.listen;
  const { containerRef: youtubeRef, ...youtube } = useYouTubePlayer(l && !l.audio ? l.video_id : null);
  const { audioRef, ...local } = useAudioPlayer(l?.audio ? mediaUrl(l.episode_id) : null);
  const player = l?.audio ? local : youtube;
  const [slow, setSlow] = usePref<boolean>("review.listenSlow", false);
  const [guess, setGuess] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  const play = () => {
    if (!l) return void speak(card.answer_en, slow ? 0.75 : 0.95);
    if (player.ready) player.playRange(Math.max(0, l.start - 0.1), l.end + 0.25, { rate: slow ? 0.75 : 1 });
  };
  // Play once as soon as the audio is ready.
  const playRef = useRef(play);
  const played = useRef(false);
  useEffect(() => {
    playRef.current = play;
  });
  const audioReady = !l || player.ready;
  useEffect(() => {
    if (audioReady && !played.current) {
      played.current = true;
      playRef.current();
    }
  }, [audioReady]);

  const rate = async (rating: number) => {
    if (busy) return;
    setBusy(true);
    await onRate(card, rating, guess, null);
  };

  useKeys((key) => {
    if (key === "p") play();
    else if (key === " " && !revealed) setRevealed(true);
    else if (revealed && ["1", "2", "3", "4"].includes(key)) void rate(Number(key));
    else return false;
    return true;
  });

  return (
    <Shell card={card}>
      {l && !l.audio && (
        <div ref={youtubeRef} className="aspect-video w-full max-w-md overflow-hidden rounded-2xl bg-black" />
      )}
      {l?.audio && <audio ref={audioRef} src={mediaUrl(l.episode_id)} preload="auto" className="hidden" />}
      <div className="flex flex-wrap items-center gap-2">
        <Btn primary onClick={play} disabled={!audioReady} title="再听一遍（P）">
          {audioReady ? <><IconReplay className="size-4" /> 再听一遍</> : <><Spinner /> 加载中</>}
        </Btn>
        <Toggle checked={slow} onChange={setSlow} title="0.75 倍速">
          慢速
        </Toggle>
        {!revealed && (
          <Btn onClick={() => setRevealed(true)} title="看答案（空格）">
            看答案
          </Btn>
        )}
      </div>
      {!revealed ? (
        <input
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) setRevealed(true);
          }}
          placeholder="听懂了什么？（可不填）"
          aria-label="听懂的意思"
          className={ANSWER_INPUT}
          autoComplete="off"
        />
      ) : (
        <div className="space-y-4">
          <SpeakAnswer text={card.answer_en} />
          <p className="text-lg leading-relaxed">
            {card.hint && <span className="font-semibold">{card.hint}：</span>}
            {card.prompt_zh}
          </p>
          {guess && <p className="text-sm text-muted">你写的：{guess}</p>}
          <RatingButtons card={card} suggested={null} busy={busy} onRate={(r) => void rate(r)} />
        </div>
      )}
    </Shell>
  );
}

/** The sentence with the expression blanked out: type the missing words. */
function ClozeCard({ card, onRate }: { card: ReviewCard; onRate: RateFn }) {
  const tokens = card.cloze ?? [];
  const expected = tokens.filter((t) => t.blank).map((t) => t.text).join(" ");
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<WordDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoSpeak] = usePref<boolean>("review.autoSpeak", true);
  const inputRef = useRef<HTMLInputElement>(null);

  const check = () => {
    setResult(diffWords(expected, typed));
    inputRef.current?.blur(); // so 1–4 rate right away
    if (autoSpeak) void speak(card.answer_en);
  };

  const rate = async (rating: number) => {
    if (busy) return;
    setBusy(true);
    await onRate(card, rating, typed, result ? result.score : null);
  };

  useKeys((key) => {
    if (key === " " && !result) check();
    else if (key === "p") void speak(card.answer_en);
    else if (result && ["1", "2", "3", "4"].includes(key)) void rate(Number(key));
    else return false;
    return true;
  });

  // Position of each blank among the blanks, to look up whether it was filled in correctly.
  const blankIndex = tokens.map((t, i) => (t.blank ? tokens.slice(0, i).filter((x) => x.blank).length : -1));
  return (
    <Shell card={card}>
      <p className="text-muted">{card.prompt_zh}</p>
      <p className="text-2xl leading-relaxed tracking-tight">
        {tokens.map((t, i) => {
          if (!t.blank) return <span key={i}>{t.text} </span>;
          const ok = result?.ref[blankIndex[i]]?.ok;
          return (
            <span key={i}>
              {t.before}
              <span
                className={cx(
                  "rounded-md px-1",
                  !result && "select-none border-b-2 border-foreground text-transparent",
                  result && (ok ? "bg-good/10 text-good" : "bg-bad-soft text-bad"),
                )}
              >
                {t.text}
              </span>
              {t.after}{" "}
            </span>
          );
        })}
      </p>
      {!result ? (
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) check();
            }}
            placeholder="按顺序填出空着的词"
            aria-label="填空"
            className="field h-12 min-w-0 flex-1 rounded-full px-5 text-lg sm:text-lg"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />
          <Btn primary large onClick={check} title="检查（Enter）">
            {typed.trim() ? "检查" : "看答案"}
          </Btn>
        </div>
      ) : (
        <div className="space-y-4">
          {typed.trim() && <Score score={result.score} label="填对了" />}
          {result.wrong.length > 0 && (
            <ul className="space-y-0.5 text-sm text-muted">
              {result.wrong.map((w, i) => (
                <li key={i}>
                  应该是 <b className="font-medium text-foreground">{w.expected}</b>，你写了 <span className="text-bad">{w.got}</span>
                </li>
              ))}
            </ul>
          )}
          {card.hint && (
            <p className="text-sm text-muted">
              表达 <span className="ml-1 font-medium text-foreground">{card.hint}</span>
            </p>
          )}
          <RatingButtons card={card} suggested={typed.trim() ? scoreToRating(result.score) : 1} busy={busy} onRate={(r) => void rate(r)} />
        </div>
      )}
    </Shell>
  );
}

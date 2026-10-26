"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  formatTime,
  loadPref,
  mediaUrl,
  savePref,
  thumbnail,
  videoUrl,
  type Chunk,
  type EpisodeDetail,
  type EpisodeStatus,
  type Sentence,
} from "@/lib/api";
import { diffWords, type WordDiff } from "@/lib/diff";
import { useAudioPlayer } from "@/lib/useAudioPlayer";
import { useLearningProgress } from "@/lib/useLearningProgress";
import { useHealth } from "@/lib/useHealth";
import { usePref } from "@/lib/usePref";
import { noRecorderReason, useRecorder, type Recording } from "@/lib/useRecorder";
import { useVideoPlayer } from "@/lib/useVideoPlayer";
import SimpleVideoPlayer from "@/components/SimpleVideoPlayer";
import { ANNOTATION_LABELS, AnnotationDetails, HighlightText } from "@/components/StudyText";
import {
  IconArrowRight,
  IconChevronDown,
  IconChevronLeft,
  IconDownload,
  IconMic,
  IconNext,
  IconPlay,
  IconPrev,
  IconRepeat,
  IconReplay,
  IconSliders,
  IconStar,
  IconStarFilled,
  IconStop,
  IconTrash,
} from "@/components/icons";
import { Badge, Btn, cx, DiffView, ErrorBar, IconBtn, preventFocus, Score, Segmented, SelectChip, Spinner, Toggle } from "@/components/ui";

type Mode = "listen" | "dictation" | "shadow";

const MODES = ["listen", "dictation", "shadow"] as const satisfies readonly Mode[];
const MODE_LABEL: Record<Mode, string> = { listen: "精听", dictation: "听写", shadow: "跟读" };
const VIA = ["audio", "video"] as const;
const RATES = [0.5, 0.75, 0.9, 1];
const LOOPS = [1, 2, 3, 0]; // 0 = keep looping until stopped
const PAD_START = 0.1; // caption times are estimates; pad so words aren't clipped
const PAD_END = 0.25;
const NUDGE = 0.2;

type DictationState = { input: string; result: WordDiff | null };
type ShadowState = Recording & { diff: WordDiff | null };
type ClipSummary = { clip: number; first: number; start: number; end: number; count: number; practiced: number; wpm: number };

const CAPTION_LABEL: Record<EpisodeDetail["caption_kind"], string> = {
  manual: "人工字幕",
  generated: "自动字幕",
  whisper: "Whisper 转写",
};
const EMPTY_DICTATION: DictationState = { input: "", result: null };
const mask = (text: string) => text.replace(/[A-Za-z0-9’']/g, "•");
const CHIP = "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-fill px-3.5 text-[13px] font-medium transition-colors";
const SENTENCE = "text-[22px] leading-relaxed tracking-[-0.01em] sm:text-2xl";

export default function Practice() {
  const id = Number(useSearchParams().get("id"));
  // Every episode shares the route /episode?id=…: opening another one starts afresh, as a new page would.
  return <EpisodePractice key={id} id={id} />;
}

function EpisodePractice({ id }: { id: number }) {
  const search = useSearchParams();
  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = Number.isInteger(id) && id > 0;

  useEffect(() => {
    if (!valid) return;
    api
      .episode(id)
      .then(setEpisode)
      .catch((e: Error) => setError(e.message));
  }, [id, valid]);

  if (!valid) return <ErrorBar message="链接里没有节目编号，回首页重新选一集。" />;
  if (error) return <ErrorBar message={error} />;
  if (!episode) return <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> 加载中</p>;
  if (episode.status !== "ready") return <Processing episode={episode} onUpdate={setEpisode} />;
  if (!episode.sentences.length) return <p className="text-sm text-muted">这个节目没有可练的句子。</p>;

  const raw = search.get("s");
  const requested = raw === null ? NaN : Number(raw);
  const initialIdx = Number.isInteger(requested) && requested >= 0 && requested < episode.sentences.length ? requested : null;
  return <PracticeView key={episode.id} episode={episode} setEpisode={setEpisode} initialIdx={initialIdx} />;
}

function BackButton() {
  return (
    <Link
      href="/"
      aria-label="返回我的节目"
      title="我的节目"
      className="glass grid size-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-(--glass-strong)"
    >
      <IconChevronLeft className="size-5" />
    </Link>
  );
}

/** Star the episode; starred ones are listed under 学习记录 → 已收藏. */
function StarButton({ episode, onChange, onError }: {
  episode: EpisodeDetail;
  onChange: (starredAt: string | null) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const starred = !!episode.starred_at;
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      onChange((await api.starEpisode(episode.id, !starred)).starred_at);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onMouseDown={preventFocus}
      onClick={() => void toggle()}
      aria-pressed={starred}
      aria-label={starred ? "取消收藏" : "收藏这一集"}
      title={starred ? "取消收藏" : "收藏这一集"}
      className={cx(
        "glass grid size-10 shrink-0 place-items-center rounded-full transition-[background-color,color,transform] hover:bg-(--glass-strong) active:scale-95",
        starred ? "text-foreground" : "text-muted",
      )}
    >
      {starred ? <IconStarFilled className="size-5" /> : <IconStar className="size-5" />}
    </button>
  );
}

type EpisodeSetter = React.Dispatch<React.SetStateAction<EpisodeDetail | null>>;
const ignoreError = () => {};

/**
 * While a background job runs (`job` is "processing"), poll just the jobs' fields and merge them in when they change,
 * so the page doesn't reload and re-render every sentence each time; reload the whole episode once the job ends (its
 * sentences, times or files may be new).
 */
function useJobPoll(episodeId: number, job: "status" | "audio_status" | "video_status", running: boolean,
                    every: number, onUpdate: EpisodeSetter, onError: (message: string) => void = ignoreError) {
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      api.episodeStatus(episodeId)
        .then((now) => {
          if (now[job] !== "processing") return api.episode(episodeId).then(onUpdate);
          onUpdate((ep) => {
            if (!ep) return ep;
            const changed = (Object.keys(now) as (keyof EpisodeStatus)[]).some((key) => ep[key] !== now[key]);
            return changed ? { ...ep, ...now } : ep;
          });
        })
        .catch((e: Error) => onError(e.message));
    }, every);
    return () => window.clearInterval(timer);
  }, [episodeId, job, running, every, onUpdate, onError]);
}

/** A podcast episode still downloading / transcribing (or failed): show progress and poll until it's ready. */
function Processing({ episode, onUpdate }: { episode: EpisodeDetail; onUpdate: EpisodeSetter }) {
  const [error, setError] = useState<string | null>(null);
  useJobPoll(episode.id, "status", episode.status === "processing", 3000, onUpdate);

  const retry = async () => {
    setError(null);
    try {
      await api.retryEpisode(episode.id);
      onUpdate({ ...episode, status: "processing", status_detail: "排队中…" });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <BackButton />
      <div className="glass flex items-center gap-4 rounded-3xl p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {episode.image_url && <img src={episode.image_url} alt="" className="size-20 shrink-0 rounded-2xl object-cover" />}
        <div className="min-w-0 space-y-1.5">
          <h1 className="font-semibold leading-snug">{episode.title}</h1>
          <p className="text-sm text-muted">{episode.channel}</p>
          {episode.status === "processing" ? (
            <p className="flex items-center gap-2 text-sm">
              <Spinner /> {episode.status_detail || "处理中…"}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-bad">处理失败：{episode.status_detail}</p>
              <Btn small primary onClick={retry}>
                重试
              </Btn>
            </div>
          )}
        </div>
      </div>
      <ErrorBar message={error} />
    </div>
  );
}

/** YouTube only: download the audio (Whisper-precise times, offline playback), then pick what plays. */
function AudioBar({
  episode,
  via,
  onVia,
  onUpdate,
}: {
  episode: EpisodeDetail;
  via: "audio" | "video";
  onVia: (v: "audio" | "video") => void;
  onUpdate: React.Dispatch<React.SetStateAction<EpisodeDetail | null>>;
}) {
  const [error, setError] = useState<string | null>(null);
  const processing = episode.audio_status === "processing";
  useJobPoll(episode.id, "audio_status", processing, 3000, onUpdate);

  const start = async () => {
    setError(null);
    try {
      await api.downloadAudio(episode.id);
      onUpdate((ep) => ep && { ...ep, audio_status: "processing", audio_detail: "排队中…" });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (episode.has_audio) {
    return (
      <Segmented
        label="播放来源"
        title={episode.audio_detail || undefined}
        options={VIA}
        value={via}
        onChange={onVia}
        format={(v) => (v === "audio" ? "音频" : "视频")}
      />
    );
  }
  if (processing) {
    return (
      <span className={cx(CHIP, "text-muted")}>
        <Spinner className="size-3.5" />
        {episode.audio_detail || "处理中…"}
      </span>
    );
  }
  const failed = episode.audio_status === "failed";
  return (
    <>
      <button
        type="button"
        onMouseDown={preventFocus}
        onClick={start}
        title="下载这个视频的音频（一小时约 60 MB）：Whisper 对准每句的时间，手机锁屏也能放"
        className={cx(CHIP, "hover:bg-fill-strong")}
      >
        <IconDownload className="size-3.5" />
        {failed ? "重新下载音频" : "下载音频"}
      </button>
      {(error || failed) && <span className="shrink-0 text-xs text-bad">{error ?? episode.audio_detail}</span>}
    </>
  );
}

/** First visit prepares the file once; subsequent visits can play it immediately. */
function VideoPreparation({ episode, cloud, onUpdate }: {
  episode: EpisodeDetail;
  cloud: boolean | undefined;
  onUpdate: React.Dispatch<React.SetStateAction<EpisodeDetail | null>>;
}) {
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(false);
  const busy = useRef(false);
  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await api.prepareVideo(episode.id);
      onUpdate(await api.episode(episode.id));
    } catch (e) { setError((e as Error).message); }
    finally { busy.current = false; }
  }, [episode.id, onUpdate]);
  useEffect(() => {
    if (cloud === false && !episode.video_status && !requested.current) {
      requested.current = true;
      void start();
    }
  }, [cloud, episode.video_status, start]);
  useJobPoll(episode.id, "video_status", episode.video_status === "processing", 2000, onUpdate, setError);
  const processing = episode.video_status === "processing";
  const failed = !!error || episode.video_status === "failed";
  return <div className="glass flex aspect-video flex-col items-center justify-center gap-3 rounded-3xl p-6 text-center">
    {cloud ? <p className="text-sm text-muted">视频还没准备好，请先在 Mac 上打开这一集。</p>
      : !failed && <p className="flex items-center gap-2 text-sm text-muted"><Spinner />{processing ? episode.video_detail || "正在准备视频…" : "正在准备视频…"}</p>}
    {failed && <p className="max-w-sm text-sm text-bad">{error ?? episode.video_detail}</p>}
    {!cloud && !processing && (error || episode.video_status) && <Btn small onClick={() => void start()}>重新准备视频</Btn>}
  </div>;
}

/** The sentence's start and end, nudged when the captions cut it off. */
function TimingMenu({ onNudge }: { onNudge: (field: "start" | "end", delta: number) => void }) {
  return (
    <details className="relative">
      <summary
        aria-label="调整这句的时间"
        title="调整这句的时间"
        className="grid size-8 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-fill hover:text-foreground"
      >
        <IconSliders className="size-4" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-60 space-y-2 rounded-2xl border border-border bg-surface p-3 text-sm text-foreground shadow-xl">
        {(["start", "end"] as const).map((field) => (
          <div key={field} className="flex items-center justify-between gap-2">
            <span className="text-muted">{field === "start" ? "开头" : "结尾"}</span>
            <span className="flex gap-1">
              <Btn small onClick={() => onNudge(field, -NUDGE)}>提前</Btn>
              <Btn small onClick={() => onNudge(field, NUDGE)}>推后</Btn>
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

function summarizeClips(sentences: Sentence[]): ClipSummary[] {
  const clips: ClipSummary[] = [];
  for (const s of sentences) {
    let c = clips[clips.length - 1];
    if (!c || c.clip !== s.clip) {
      c = { clip: s.clip, first: s.idx, start: s.start, end: s.end, count: 0, practiced: 0, wpm: 0 };
      clips.push(c);
    }
    c.end = s.end;
    c.count += 1;
    c.wpm += s.text.split(/\s+/).length; // word count for now
    if (s.dictation_score !== null || s.shadow_score !== null) c.practiced += 1;
  }
  for (const c of clips) c.wpm = Math.round(c.wpm / Math.max((c.end - c.start) / 60, 0.1));
  return clips;
}

function PracticeView({
  episode,
  setEpisode,
  initialIdx,
}: {
  episode: EpisodeDetail;
  setEpisode: React.Dispatch<React.SetStateAction<EpisodeDetail | null>>;
  initialIdx: number | null;
}) {
  const sentences = episode.sentences;
  const isPodcast = episode.source === "podcast";
  const [via, setVia] = usePref<"audio" | "video">(`via:${episode.id}`, "video");
  const useAudio = isPodcast || (episode.has_audio && via === "audio");
  const video = useVideoPlayer(!useAudio && episode.has_video ? videoUrl(episode.id) : null);
  const { audioRef: mediaRef, ...local } = useAudioPlayer(useAudio ? mediaUrl(episode.id) : null);
  const { ready, error: playerError, playRange, stop } = useAudio ? local : video;
  const recorder = useRecorder({ audio: true, live: false });
  const health = useHealth(); // on a cloud server there's no downloading audio

  const [cur, setCur] = useState(() => {
    const saved = loadPref(`pos:${episode.id}`, 0);
    const resume = episode.last_sentence_idx ?? saved;
    return initialIdx ?? (resume >= 0 && resume < sentences.length ? resume : 0);
  });
  const [mode, setMode] = useState<Mode>(() => {
    const saved = loadPref<string>("mode", "listen");
    return MODES.some((m) => m === saved) ? (saved as Mode) : "listen"; // e.g. the old commute mode
  });
  const [showText, setShowText] = useState(() => loadPref("showText", false));
  const [rate, setRate] = useState(() => loadPref("rate", 1));
  const [loops, setLoops] = useState(() => loadPref("loops", 1));
  const [follow, setFollow] = useState(() => loadPref("follow", false));
  const [showZh, setShowZh] = useState(() => loadPref("showZh", true));
  const [dictation, setDictation] = useState<Record<number, DictationState>>({});
  const [shadow, setShadow] = useState<Record<number, ShadowState>>({});
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const clipsRef = useRef<HTMLDivElement>(null);
  const annotationPanelRef = useRef<HTMLDivElement>(null);
  const autoStopRef = useRef<number | null>(null);
  const recordingFor = useRef<Sentence | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef(new Map<number, string>());

  const s = sentences[cur];
  const firstVideoTime = useRef(s.start);
  const { ready: videoReady, seekTo: seekVideoTo } = video;
  useEffect(() => {
    firstVideoTime.current = s.start;
  }, [s.start]);
  useEffect(() => {
    if (videoReady) seekVideoTo(firstVideoTime.current);
  }, [videoReady, seekVideoTo]);
  const clips = useMemo(() => summarizeClips(sentences), [sentences]);
  const clip = clips.find((c) => c.clip === s.clip)!;
  const clipSentences = useMemo(() => sentences.filter((x) => x.clip === s.clip), [sentences, s.clip]);
  const d = dictation[s.id] ?? EMPTY_DICTATION;
  const sh = shadow[s.id] ?? null;
  const lesson = episode.lessons?.find((item) => item.clip === s.clip);
  const selected = s.annotations?.find((item) => item.id === selectedAnnotation);
  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId !== undefined) annotationPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);
  const onProgress = useCallback((progress: import("@/lib/api").LearningProgress) => {
    setEpisode((ep) => ep && { ...ep, ...progress });
  }, [setEpisode]);
  const syncError = useLearningProgress(episode.id, sentences, (useAudio ? local : video).readPlayback, onProgress);

  useEffect(() => savePref(`pos:${episode.id}`, cur), [episode.id, cur]);
  useEffect(() => {
    void api.savePosition(episode.id, s.id).catch(() => undefined);
  }, [episode.id, s.id]);
  useEffect(() => {
    savePref("mode", mode);
    savePref("showText", showText);
    savePref("rate", rate);
    savePref("loops", loops);
    savePref("follow", follow);
    savePref("showZh", showZh);
  }, [mode, showText, rate, loops, follow, showZh]);
  useEffect(() => {
    // Scroll the sentence list only, never the page (scrollIntoView would): on a phone the list sits below the player.
    const list = listRef.current;
    const item = list?.querySelector(`[data-idx="${cur}"]`);
    if (!list || !item) return;
    const box = list.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    if (r.top < box.top) list.scrollTop += r.top - box.top;
    else if (r.bottom > box.bottom) list.scrollTop += r.bottom - box.bottom;
  }, [cur]);
  useEffect(() => {
    // Keep the current clip's pill in view in the sideways strip, again without moving the page.
    const strip = clipsRef.current;
    const pill = strip?.querySelector<HTMLElement>(`[data-clip="${s.clip}"]`);
    if (!strip || !pill) return;
    const box = strip.getBoundingClientRect();
    const r = pill.getBoundingClientRect();
    if (r.left < box.left || r.right > box.right) strip.scrollLeft += r.left - box.left - (box.width - r.width) / 2;
  }, [s.clip]);
  useEffect(() => {
    if (mode === "dictation") inputRef.current?.focus();
  }, [mode, cur]);
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      if (autoStopRef.current) window.clearTimeout(autoStopRef.current);
      audioRef.current?.pause();
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const patchSentence = useCallback(
    (sentenceId: number, patch: Partial<Sentence>) =>
      setEpisode((ep) => ep && { ...ep, sentences: ep.sentences.map((x) => (x.id === sentenceId ? { ...x, ...patch } : x)) }),
    [setEpisode],
  );

  const playSentence = (x: Sentence, opts: { loops?: number; onEnd?: () => void } = {}) => {
    const n = opts.loops ?? loops;
    playRange(Math.max(0, x.start - PAD_START), x.end + PAD_END, { rate, loops: n === 0 ? Infinity : n, onEnd: opts.onEnd });
  };

  const go = (idx: number, autoplay = true) => {
    const next = Math.min(Math.max(idx, 0), sentences.length - 1);
    setCur(next);
    if (autoplay) playSentence(sentences[next]);
  };

  const playClip = () => {
    const first = clipSentences[0];
    const last = clipSentences[clipSentences.length - 1];
    playRange(Math.max(0, first.start - PAD_START), last.end + PAD_END, {
      rate,
      loops: 1,
      onTick: (t) => {
        const hit = clipSentences.findLast((x) => x.start - PAD_START <= t);
        if (hit) setCur(hit.idx);
      },
    });
  };

  const followVideoPosition = (time: number) => {
    const sentence = sentences.findLast((item) => item.start <= time) ?? sentences[0];
    setCur(sentence.idx);
  };

  const playVideoFrom = (time: number) => {
    const start = time >= video.duration - 0.1 ? 0 : time;
    followVideoPosition(start);
    video.playRange(start, video.duration, { rate, loops: 1, onTick: followVideoPosition });
  };

  const seekVideo = (time: number, resume: boolean) => {
    video.stop();
    const target = Math.max(0, Math.min(time, video.duration));
    followVideoPosition(target);
    firstVideoTime.current = target;
    video.seekTo(target);
    if (resume && target < video.duration) playVideoFrom(target);
  };

  const toggleVideo = () => {
    if (video.readPlayback().playing) video.stop();
    else playVideoFrom(video.readPlayback().time);
  };

  const setInput = (input: string) => setDictation((m) => ({ ...m, [s.id]: { ...d, input } }));

  const check = () => {
    if (d.result) return go(cur + 1);
    const result = diffWords(s.text, d.input);
    setDictation((m) => ({ ...m, [s.id]: { ...d, result } }));
    if (!d.input.trim()) return; // an empty check just reveals the answer
    patchSentence(s.id, { dictation_score: result.score });
    api
      .saveAttempt({
        sentence_id: s.id,
        kind: "dictation",
        user_text: d.input,
        score: result.score,
        details: { missed: result.missed, wrong: result.wrong },
      })
      .catch((e: Error) => setMessage(e.message));
  };

  const finishRecording = async () => {
    if (autoStopRef.current) window.clearTimeout(autoStopRef.current);
    autoStopRef.current = null;
    const target = recordingFor.current;
    recordingFor.current = null;
    setStopping(true);
    const rec = await recorder.stop();
    setStopping(false);
    if (!rec || !target) return;

    const old = urlsRef.current.get(target.id);
    if (old) URL.revokeObjectURL(old);
    if (rec.url) urlsRef.current.set(target.id, rec.url);
    const diff = rec.transcript ? diffWords(target.text, rec.transcript) : null;
    setShadow((m) => ({ ...m, [target.id]: { ...rec, diff } }));
    if (!diff) return;
    patchSentence(target.id, { shadow_score: diff.score });
    api
      .saveAttempt({
        sentence_id: target.id,
        kind: "shadow",
        user_text: rec.transcript,
        score: diff.score,
        details: { missed: diff.missed, wrong: diff.wrong },
      })
      .catch((e: Error) => setMessage(e.message));
  };

  const toggleRecord = async () => {
    if (stopping || starting) return;
    if (recorder.recording) return finishRecording();
    setMessage(null);
    setStarting(true);
    // The first time, the browser asks for microphone permission and start() waits for the answer.
    const hint = window.setTimeout(() => setMessage("在等麦克风权限：请在浏览器弹窗或地址栏里允许使用麦克风。"), 4000);
    try {
      await recorder.start();
      setMessage(null);
    } catch (e) {
      return setMessage((e as Error).message);
    } finally {
      window.clearTimeout(hint);
      setStarting(false);
    }
    recordingFor.current = s;
    const spoken = (s.end - s.start) / rate;
    const autoStop = (ms: number) => {
      autoStopRef.current = window.setTimeout(() => void finishRecording(), ms);
    };
    if (follow) {
      playSentence(s, { loops: 1, onEnd: () => autoStop(1200) });
    } else {
      stop();
      autoStop(Math.max(4, spoken * 2 + 2) * 1000);
    }
  };

  const playMine = (url: string) => {
    audioRef.current?.pause();
    audioRef.current = new Audio(url);
    void audioRef.current.play();
  };

  const nudge = async (field: "start" | "end", delta: number) => {
    const value = Math.max(0, Math.round((s[field] + delta) * 100) / 100);
    try {
      const r = await api.updateTiming(s.id, { [field]: value });
      patchSentence(s.id, { start: r.start, end: r.end });
      playSentence({ ...s, start: r.start, end: r.end }, { loops: 1 });
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const saveExpression = async (pattern: string, meaning: string) => {
    try {
      const saved = await api.saveChunk(s.id, pattern, meaning);
      patchSentence(s.id, { saved: [...s.saved.filter((x) => x.id !== saved.id), saved] });
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      return false;
    }
  };

  const removeExpression = async (chunk: Chunk) => {
    try {
      await api.deleteChunk(chunk.id);
      patchSentence(s.id, { saved: s.saved.filter((x) => x.id !== chunk.id) });
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  // Keyboard shortcuts. The listener is bound once; it calls the latest handler.
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const typing =
      (el instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(el.type)) ||
      el instanceof HTMLTextAreaElement ||
      el.isContentEditable;
    if (typing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const actions: Record<string, () => void> = {
      " ": () => playSentence(s),
      ArrowLeft: () => go(cur - 1),
      ArrowRight: () => go(cur + 1),
      Escape: () => stop(),
      s: () => setShowText((v) => !v),
      z: () => setShowZh((v) => !v),
      r: () => mode === "shadow" && void toggleRecord(),
      "1": () => setMode("listen"),
      "2": () => setMode("dictation"),
      "3": () => setMode("shadow"),
    };
    if (actions[key]) {
      e.preventDefault();
      actions[key]();
    }
  };
  const keyHandler = useRef(onKey);
  useEffect(() => {
    keyHandler.current = onKey;
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const textVisible = (x: Sentence) =>
    mode === "dictation" ? !!dictation[x.id]?.result : mode === "shadow" || showText;
  // The sentence is on screen: only then the Chinese and picking expressions, so neither spoils the listening.
  const revealed = mode === "shadow" || (mode === "listen" && showText) || (mode === "dictation" && !!d.result);
  const notice =
    episode.segmented_by === "fallback"
      ? "自动字幕没有标点，句子是按长度粗切的。下载音频后，还没练过的句子会按标点重新切。"
      : null;
  const practiced = sentences.filter((x) => x.dictation_score !== null || x.shadow_score !== null).length;

  return (
    // data-immersive: on phones the site header steps aside (globals.css) so the sentence fits on the first screen.
    <div data-immersive className="space-y-5">
      <header className="flex items-start gap-3">
        <BackButton />
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="line-clamp-1 text-lg font-semibold leading-snug tracking-tight sm:line-clamp-2 sm:text-2xl">{episode.title}</h1>
          <p className="mt-1 truncate text-[13px] text-muted">
            {[episode.channel, CAPTION_LABEL[episode.caption_kind], `已听 ${episode.heard_count ?? 0} · 已练 ${practiced} / ${sentences.length} 句`]
              .filter(Boolean)
              .join(" · ")}
            {syncError && " · 收听记录同步中"}
          </p>
        </div>
        <StarButton episode={episode} onChange={(starred_at) => setEpisode((ep) => ep && { ...ep, starred_at })} onError={setMessage} />
      </header>

      {notice && <p className="rounded-2xl bg-fill px-4 py-3 text-sm text-muted">{notice}</p>}
      <ErrorBar message={message ?? playerError} onClose={message ? () => setMessage(null) : undefined} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:gap-8">
        {/* Phones put the sentence right under the player and the playback settings after it (order-*); wide screens keep this order. */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="sticky top-0 z-20 -mx-4 bg-background/85 px-4 pb-2 pt-2 backdrop-blur-xl md:static md:m-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            {useAudio ? (
              <div key="audio" className="glass flex items-center gap-3 rounded-3xl p-2.5">
                {thumbnail(episode) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnail(episode)!}
                    alt=""
                    className={cx("h-14 shrink-0 rounded-2xl object-cover", isPodcast ? "w-14" : "aspect-video")}
                  />
                )}
                <audio ref={mediaRef} src={mediaUrl(episode.id)} controls preload="auto" className="h-10 min-w-0 flex-1" />
              </div>
            ) : episode.has_video ? <SimpleVideoPlayer key="video" videoRef={video.videoRef} src={videoUrl(episode.id)}
              ready={video.ready} duration={video.duration}
              onToggle={toggleVideo} onSeek={seekVideo} />
              : <VideoPreparation episode={episode} cloud={health?.cloud} onUpdate={setEpisode} />}
          </div>

          <div>
            <Segmented stretch label="练习模式" options={MODES} value={mode} onChange={setMode} format={(m) => MODE_LABEL[m]} />
          </div>
          <div className="order-1 lg:order-none">
            <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              <SelectChip label="播放速度" options={RATES} value={rate} onChange={setRate} format={(r) => `${r}x`} />
              <SelectChip
                label="每句播几遍"
                options={LOOPS}
                value={loops}
                onChange={setLoops}
                format={(n) => (n ? `${n} 遍` : "循环")}
                icon={<IconRepeat className="size-3.5" />}
              />
              {mode === "listen" && (
                <Toggle checked={showText} onChange={setShowText} title="字幕（S）">
                  字幕
                </Toggle>
              )}
              {mode === "shadow" && (
                <Toggle checked={follow} onChange={setFollow} title="边放原声边跟读，要戴耳机">
                  边放边跟
                </Toggle>
              )}
              {sentences.some((x) => x.translation_zh) && (
                <Toggle checked={showZh} onChange={setShowZh} title="中文（Z）">
                  中文
                </Toggle>
              )}
              {!isPodcast && (episode.has_audio || health?.cloud === false) && (
                <AudioBar episode={episode} via={via} onVia={setVia} onUpdate={setEpisode} />
              )}
            </div>
          </div>

          <section className="glass space-y-5 rounded-3xl p-5 sm:p-7" aria-label="当前句子">
            <div className="flex items-center justify-between gap-2 text-[13px] text-muted">
              <span className="tabular-nums">
                {cur + 1} / {sentences.length}
                <span className="mx-1.5 text-subtle">·</span>
                {formatTime(s.start)}
              </span>
              <TimingMenu onNudge={(field, delta) => void nudge(field, delta)} />
            </div>

            {mode === "listen" && (
              showText ? (
                <p className={SENTENCE}>
                  <HighlightText text={s.text} annotations={s.annotations ?? []} onSelect={(a) => setSelectedAnnotation(a.id)} />
                </p>
              ) : (
                <button
                  type="button"
                  onMouseDown={preventFocus}
                  onClick={() => setShowText(true)}
                  title="显示字幕（S）"
                  className={cx(SENTENCE, "block w-full break-words text-left text-subtle")}
                >
                  {mask(s.text)}
                </button>
              )
            )}

            {mode === "dictation" && (
              <div className="space-y-4">
                <input
                  ref={inputRef}
                  value={d.input}
                  onChange={(e) => setInput(e.target.value)}
                  readOnly={!!d.result}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter") {
                      e.preventDefault();
                      check();
                    } else if (e.key === "Tab") {
                      e.preventDefault();
                      playSentence(s);
                    } else if (e.key === "Escape") {
                      stop();
                    }
                  }}
                  placeholder="听到什么就打什么"
                  aria-label="听写"
                  className="field w-full rounded-2xl px-4 py-3 text-lg sm:text-lg"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                {d.result ? (
                  <div className="space-y-4">
                    <Score score={d.result.score} label="听写" />
                    <DiffView diff={d.result} userLabel="你写的" wrongVerb="听成了" />
                    <Btn primary onClick={() => go(cur + 1)} disabled={cur === sentences.length - 1} title="下一句（Enter）">
                      下一句 <IconArrowRight className="size-4" />
                    </Btn>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Btn primary onClick={check} title="检查（Enter）">
                      检查
                    </Btn>
                    <Btn onClick={() => playSentence(s)} title="重播（Tab）">
                      <IconReplay className="size-4" /> 重播
                    </Btn>
                  </div>
                )}
              </div>
            )}

            {mode === "shadow" && (
              <div className="space-y-4">
                <p className={SENTENCE}>
                  <HighlightText text={s.text} annotations={s.annotations ?? []} onSelect={(a) => setSelectedAnnotation(a.id)} />
                </p>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    primary={!recorder.recording}
                    danger={recorder.recording}
                    onClick={() => void toggleRecord()}
                    disabled={stopping || starting}
                    title="录音（R）"
                  >
                    {recorder.recording ? (
                      <><IconStop className="size-3.5" /> 停止</>
                    ) : starting ? (
                      <><Spinner /> 等待麦克风</>
                    ) : stopping ? (
                      <><Spinner /> 处理中</>
                    ) : (
                      <><IconMic className="size-4" /> 录音</>
                    )}
                  </Btn>
                  {sh?.url && (
                    <>
                      <Btn onClick={() => playMine(sh.url!)}>
                        <IconPlay className="size-3.5" /> 我的录音
                      </Btn>
                      <Btn onClick={() => playSentence(s, { loops: 1, onEnd: () => playMine(sh.url!) })}>原声 → 我的</Btn>
                    </>
                  )}
                </div>
                {!recorder.support.recorder && <p className="text-sm text-muted">{noRecorderReason()}</p>}
                {sh?.diff && (
                  <div className="space-y-3">
                    <Score score={sh.diff.score} label="识别出" />
                    <DiffView diff={sh.diff} userLabel="识别到" wrongVerb="被识别成" />
                  </div>
                )}
                {sh && !sh.diff && (
                  <p className="text-sm text-muted">{sh.recognitionError ?? "没识别出内容，可以听录音自己对比。"}</p>
                )}
              </div>
            )}

            {revealed && showZh && s.translation_zh && (
              <p className="leading-relaxed text-muted">{s.translation_zh}</p>
            )}
          </section>

          {/* Phones: a floating bar within thumb reach. Wide screens: a row under the sentence. */}
          <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] lg:static lg:p-0">
            <div className="glass-strong lg:glass-none mx-auto flex max-w-md items-center gap-2 rounded-full p-1.5 lg:mx-0 lg:max-w-none lg:p-0">
              <IconBtn label="上一句（←）" onClick={() => go(cur - 1)} disabled={!ready || cur === 0} className="size-12 lg:size-11">
                <IconPrev className="size-5" />
              </IconBtn>
              <button
                type="button"
                onMouseDown={preventFocus}
                onClick={() => playSentence(s)}
                disabled={!ready}
                title="重播（空格）"
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-foreground font-medium text-background transition-[opacity,transform] hover:opacity-85 active:scale-[0.98] disabled:opacity-40 lg:h-11 lg:flex-none lg:px-8"
              >
                {!ready && !playerError ? <><Spinner /> 加载中</> : <><IconReplay className="size-5" /> 重播</>}
              </button>
              <IconBtn label="下一句（→）" onClick={() => go(cur + 1)} disabled={!ready || cur === sentences.length - 1} className="size-12 lg:size-11">
                <IconNext className="size-5" />
              </IconBtn>
            </div>
          </div>

          {revealed && selected && <div ref={annotationPanelRef} className="order-2 lg:order-none"><AnnotationDetails key={selected.id} annotation={selected}
            saved={s.saved.some((item) => item.pattern === selected.text.replace(/\s+/g, " ").trim())} onSave={saveExpression}
            onPlay={() => playSentence(s, { loops: 1 })} onClose={() => setSelectedAnnotation(null)} /></div>}
          {revealed && mode === "dictation" && !!s.annotations?.length && (
            <div className="order-2 flex flex-wrap gap-2 text-[15px] lg:order-none" aria-label="这句的重点表达">{s.annotations.map((a) => (
              <button key={a.id} className="study-highlight" onClick={() => setSelectedAnnotation(a.id)}>{a.text}</button>
            ))}</div>
          )}
          {revealed && (
            <details className="glass group order-2 rounded-3xl lg:order-none">
              <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-3xl px-5 py-4 text-sm font-medium">
                <span>
                  收藏表达
                  {s.saved.length > 0 && <span className="ml-1.5 text-muted">{s.saved.length}</span>}
                </span>
                <IconChevronDown className="size-4 text-subtle transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-5 pb-5">
                <SavePanel key={s.id} sentence={s} onSave={saveExpression} onRemove={removeExpression} />
              </div>
            </details>
          )}
        </div>

        <aside className="min-w-0 space-y-4" aria-label="片段">
          <div ref={clipsRef} className="-mx-4 flex gap-2 overflow-x-auto px-4 max-lg:no-scrollbar lg:mx-0 lg:px-0 lg:pb-1 lg:[scrollbar-width:thin]">
            {clips.map((c) => (
              <button
                key={c.clip}
                data-clip={c.clip}
                onMouseDown={preventFocus}
                onClick={() => go(c.first, false)}
                aria-current={c.clip === s.clip ? "true" : undefined}
                className={cx(
                  "shrink-0 rounded-2xl px-3.5 py-2 text-left transition-colors",
                  c.clip === s.clip ? "bg-foreground text-background" : "bg-fill hover:bg-fill-strong",
                )}
              >
                <span className="block text-sm font-medium">片段 {c.clip + 1}</span>
                <span className={cx("block text-[11px] tabular-nums", c.clip === s.clip ? "opacity-70" : "text-muted")}>
                  {formatTime(c.start)} · {c.practiced}/{c.count}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="mr-auto text-[13px] tabular-nums text-muted">
              {formatTime(clip.end - clip.start)} · {clip.wpm} 词/分
            </span>
            <Btn small onClick={playClip} disabled={!ready} title="不看字幕，把这段从头听一遍">
              <IconPlay className="size-3" /> 盲听整段
            </Btn>
            <Link
              href={`/retell?episode=${episode.id}&clip=${s.clip}`}
              title="用自己的话把这段说三遍"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[13px] font-medium transition-colors hover:bg-fill-strong"
            >
              <IconMic className="size-3.5" /> 复述
            </Link>
          </div>
          {lesson && <section className="glass space-y-2 rounded-3xl p-5" aria-label="片段学习目标">
            <p className="text-[13px] text-muted">本段目标</p>
            {lesson.title && <h2 className="font-semibold leading-snug">{lesson.title}</h2>}
            {lesson.goal && <p className="text-sm leading-relaxed">{lesson.goal}</p>}
            {revealed && lesson.summary && <p className="text-sm leading-relaxed text-muted">{lesson.summary}</p>}
          </section>}
          {revealed && clipSentences.some((x) => textVisible(x) && x.annotations?.length) && <details className="glass group rounded-3xl">
            <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-3xl px-5 py-4 text-sm font-medium">
              本段重点
              <IconChevronDown className="size-4 text-subtle transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-3 px-5 pb-5">{(["word", "phrase", "expression"] as const).map((kind) => {
              const items = clipSentences.filter(textVisible).flatMap((x) => (x.annotations ?? []).filter((a) => a.kind === kind).map((a) => ({ sentence: x, annotation: a })));
              return items.length > 0 && <div key={kind} className="space-y-1.5"><p className="text-xs text-muted">{ANNOTATION_LABELS[kind]}</p>
                <div className="flex flex-wrap gap-2">{items.map(({ sentence, annotation }) => <button key={annotation.id} className="study-highlight text-sm"
                  onClick={() => { go(sentence.idx, false); setSelectedAnnotation(annotation.id); }}>{annotation.text}</button>)}</div>
              </div>;
            })}</div>
          </details>}
          <ol ref={listRef} className="glass max-h-[60vh] space-y-0.5 overflow-y-auto rounded-3xl p-2 lg:max-h-[calc(100dvh-18rem)]">
            {clipSentences.map((x) => (
              <li key={x.id} data-idx={x.idx}>
                <button
                  onMouseDown={preventFocus}
                  onClick={(event) => {
                    const mark = (event.target as HTMLElement).closest<HTMLElement>("[data-annotation]");
                    go(x.idx, !mark);
                    if (mark) setSelectedAnnotation(Number(mark.dataset.annotation));
                  }}
                  className={cx(
                    "w-full rounded-2xl px-3.5 py-3 text-left text-[15px] leading-relaxed transition-colors",
                    x.idx === cur ? "bg-fill-strong" : "hover:bg-fill",
                  )}
                >
                  <span className="mr-2 text-xs tabular-nums text-subtle">{x.idx + 1}</span>
                  <span className={textVisible(x) ? "" : "text-subtle"}>{textVisible(x) ? <HighlightText text={x.text} annotations={x.annotations ?? []} /> : mask(x.text)}</span>
                  {textVisible(x) && showZh && x.translation_zh && <span className="mt-1 block text-[13px] leading-relaxed text-muted">{x.translation_zh}</span>}
                  {x.dictation_score !== null && <Badge label="写" score={x.dictation_score} />}
                  {x.shadow_score !== null && <Badge label="读" score={x.shadow_score} />}
                </button>
              </li>
            ))}
          </ol>
          <p className="hidden text-xs leading-loose text-subtle pointer-fine:block">
            <kbd>空格</kbd> 重播 · <kbd>←</kbd> <kbd>→</kbd> 上/下一句 · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> 模式 · <kbd>S</kbd> 字幕 ·{" "}
            <kbd>Z</kbd> 中文 · <kbd>R</kbd> 录音 · <kbd>Esc</kbd> 停止
          </p>
        </aside>
      </div>
    </div>
  );
}

const edge = /^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g; // punctuation stuck to the first or last picked word

/** Pick an expression out of the sentence (its first and last word), write what it means, and it goes into review. */
function SavePanel({
  sentence,
  onSave,
  onRemove,
}: {
  sentence: Sentence;
  onSave: (pattern: string, meaning: string) => Promise<boolean>;
  onRemove: (chunk: Chunk) => void;
}) {
  const words = sentence.text.split(/\s+/);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [pattern, setPattern] = useState("");
  const [meaning, setMeaning] = useState("");
  const [busy, setBusy] = useState(false);

  // The first click picks a word, a click on another word extends to it, the next click starts over.
  const pick = (i: number) => {
    const next: [number, number] =
      range && range[0] === range[1] && i !== range[0] ? [Math.min(range[0], i), Math.max(range[0], i)] : [i, i];
    setRange(next);
    setPattern(words.slice(next[0], next[1] + 1).join(" ").replace(edge, ""));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim() || !meaning.trim() || busy) return;
    setBusy(true);
    if (await onSave(pattern, meaning)) {
      setRange(null);
      setPattern("");
      setMeaning("");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">点选首尾两个词</p>
      <div className="flex flex-wrap gap-1 text-lg">
        {words.map((w, i) => (
          <button
            key={i}
            onMouseDown={preventFocus}
            onClick={() => pick(i)}
            className={cx(
              "rounded-lg px-1.5 py-0.5 transition-colors",
              range && i >= range[0] && i <= range[1] ? "bg-foreground text-background" : "hover:bg-fill",
            )}
          >
            {w}
          </button>
        ))}
      </div>
      {range && (
        <form onSubmit={save} className="flex flex-col gap-2 sm:flex-row">
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="表达" className="field h-11 rounded-full px-4 sm:h-10 sm:w-52" />
          <input
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            placeholder="中文意思"
            aria-label="中文意思"
            className="field h-11 min-w-0 flex-1 rounded-full px-4 sm:h-10"
          />
          <button
            type="submit"
            disabled={busy || !pattern.trim() || !meaning.trim()}
            className="h-11 shrink-0 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity disabled:opacity-35 sm:h-10"
          >
            {busy ? "收藏中…" : "收藏"}
          </button>
        </form>
      )}
      {sentence.saved.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl bg-fill text-sm">
          {sentence.saved.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-1.5 pl-4 pr-1.5">
              <span className="font-medium">{c.pattern}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{c.meaning_zh}</span>
              <button
                onClick={() => onRemove(c)}
                aria-label={`删除「${c.pattern}」`}
                title="删除"
                className="grid size-8 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:bg-fill hover:text-bad"
              >
                <IconTrash className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// The Web Speech API isn't in every TypeScript DOM lib yet; type just what we use.
type RecognitionResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Browsers only allow the microphone on https or localhost, so a phone opening http://<LAN IP>:3030 can't record.
const INSECURE = "用 http 局域网地址打开时浏览器不让用麦克风，要换成 https 地址（README「在手机上用」里有办法）。";
const insecure = () => typeof window !== "undefined" && !window.isSecureContext;

/** Why recording isn't available in this browser. */
export const noRecorderReason = () => (insecure() ? INSECURE : "这个浏览器不支持录音，换 Chrome 试试。");

const RECOGNITION_ERRORS: Record<string, string> = {
  "not-allowed": "没有麦克风权限，或浏览器不允许语音识别。",
  "service-not-allowed": "浏览器不允许语音识别（建议用 Chrome）。",
  network: "语音识别需要联网（Chrome 会把声音发给 Google 识别），网络不通。",
  "audio-capture": "找不到麦克风。",
  "language-not-supported": "浏览器不支持英文识别。",
};
// After these, restarting recognition can't help.
const FATAL = new Set(["not-allowed", "service-not-allowed", "network", "audio-capture", "language-not-supported"]);

type Support = { recorder: boolean; recognition: boolean };
const NO_SUPPORT: Support = { recorder: false, recognition: false };
let cachedSupport: Support | null = null;
const noSubscribe = () => () => {};

function browserSupport(): Support {
  cachedSupport ??= {
    recorder: typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices,
    recognition: !!recognitionCtor(),
  };
  return cachedSupport;
}

export type Recording = {
  url: string | null; // the audio, when recorded with { audio: true }
  transcript: string; // what speech recognition heard; empty if unavailable
  recognitionError: string | null;
  seconds: number;
  // Only with { levels: true }: time spent actually speaking, and silences of 1s or more between speech.
  speakingSeconds: number | null;
  pauses: number[];
};

type Options = {
  audio?: boolean; // keep a recording to play back
  levels?: boolean; // measure speaking time and pauses from the microphone level
  live?: boolean; // keep `interim` (the live transcript) up to date; off saves re-renders when nothing shows it
};

type Session = {
  chunks: Blob[];
  finals: string[];
  interim: string;
  error: string | null;
  startedAt: number;
  speakingMs: number;
  silenceMs: number;
  heardSpeech: boolean;
  pauses: number[];
};

const newSession = (): Session => ({
  chunks: [],
  finals: [],
  interim: "",
  error: null,
  startedAt: performance.now(),
  speakingMs: 0,
  silenceMs: 0,
  heardSpeech: false,
  pauses: [],
});

type Ref<T> = { current: T };
type ListenContext = {
  session: Ref<Session>;
  active: Ref<boolean>; // keep restarting while true
  rec: Ref<Recognition | null>;
  done: Ref<Promise<void>>; // resolves when recognition has fully ended
  onLive: (text: string) => void;
};

function listen(ctx: ListenContext) {
  const Ctor = recognitionCtor();
  if (!Ctor) return;
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    const s = ctx.session.current;
    let live = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) s.finals.push(r[0].transcript);
      else live += r[0].transcript;
    }
    s.interim = live;
    ctx.onLive([...s.finals, live].join(" ").replace(/\s+/g, " ").trim());
  };
  rec.onerror = (e) => {
    if (e.error === "aborted" || e.error === "no-speech") return;
    ctx.session.current.error =
      (e.error === "not-allowed" && insecure() ? INSECURE : RECOGNITION_ERRORS[e.error]) ?? `语音识别出错：${e.error}`;
    if (FATAL.has(e.error)) ctx.active.current = false;
  };
  ctx.done.current = new Promise((resolve) => {
    rec.onend = () => {
      // Keep what was mid-sentence, then carry on if the learner is still talking.
      const s = ctx.session.current;
      if (s.interim) s.finals.push(s.interim);
      s.interim = "";
      if (ctx.active.current) {
        listen(ctx);
        void ctx.done.current.then(resolve);
      } else {
        resolve();
      }
    };
  });
  try {
    rec.start();
    ctx.rec.current = rec;
  } catch {
    ctx.session.current.error = "语音识别启动失败。";
    ctx.rec.current = null;
    ctx.done.current = Promise.resolve();
  }
}

const PAUSE_MS = 1000;
const TICK_MS = 50;

/**
 * Microphone + speech recognition for one utterance at a time.
 * Recognition restarts itself if the browser ends it early (Chrome stops after a few seconds of silence).
 */
export function useRecorder({ audio = false, levels = false, live = true }: Options = {}) {
  const support = useSyncExternalStore(noSubscribe, browserSupport, () => NO_SUPPORT);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState(""); // live transcript while recording

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const runningRef = useRef(false); // between start() and stop()
  const activeRef = useRef(false); // recognition should keep restarting
  const recognitionDone = useRef<Promise<void>>(Promise.resolve());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterRef = useRef<number | null>(null);
  const session = useRef<Session>(newSession());

  const releaseMic = useCallback(() => {
    if (meterRef.current) window.clearInterval(meterRef.current);
    meterRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(
    () => () => {
      activeRef.current = false;
      recognitionRef.current?.abort();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseMic();
    },
    [releaseMic],
  );

  const startRecognition = useCallback(
    () => listen({ session, active: activeRef, rec: recognitionRef, done: recognitionDone, onLive: live ? setInterim : () => {} }),
    [live],
  );

  const startMeter = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    audioCtxRef.current = ctx;
    const buf = new Float32Array(analyser.fftSize);
    let floor = 1;
    let hangover = 0;
    meterRef.current = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      floor = Math.min(floor * 1.002, Math.max(rms, 1e-4)); // slowly adapting noise floor
      const s = session.current;
      if (rms > Math.max(0.012, floor * 3)) hangover = 250;
      else hangover -= TICK_MS;
      if (hangover > 0) {
        if (s.heardSpeech && s.silenceMs >= PAUSE_MS) s.pauses.push(s.silenceMs / 1000);
        s.silenceMs = 0;
        s.heardSpeech = true;
        s.speakingMs += TICK_MS;
      } else if (s.heardSpeech) {
        s.silenceMs += TICK_MS;
      }
    }, TICK_MS);
  }, []);

  const start = useCallback(async () => {
    const needMic = audio || levels;
    if (needMic && !support.recorder) throw new Error(noRecorderReason());
    if (!needMic && !support.recognition) throw new Error("这个浏览器不支持语音识别，换 Chrome 试试，或者直接打字。");
    session.current = newSession();
    setInterim("");
    if (needMic) {
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        throw new Error("拿不到麦克风：请在浏览器地址栏允许麦克风权限。");
      }
      if (audio) {
        const recorder = new MediaRecorder(streamRef.current);
        recorder.ondataavailable = (e) => {
          if (e.data.size) session.current.chunks.push(e.data);
        };
        recorder.start();
        recorderRef.current = recorder;
      }
      if (levels) startMeter(streamRef.current);
    }
    activeRef.current = true;
    runningRef.current = true;
    startRecognition();
    session.current.startedAt = performance.now();
    setRecording(true);
  }, [audio, levels, support.recorder, support.recognition, startMeter, startRecognition]);

  const stop = useCallback(async (): Promise<Recording | null> => {
    if (!runningRef.current) return null;
    runningRef.current = false;
    activeRef.current = false;
    const recorder = recorderRef.current;
    const stopped =
      recorder && recorder.state === "recording"
        ? new Promise<void>((resolve) => {
            recorder.onstop = () => resolve();
            recorder.stop();
          })
        : Promise.resolve();
    recognitionRef.current?.stop();
    // Final recognition results arrive shortly after stop(); don't wait forever.
    await Promise.all([stopped, Promise.race([recognitionDone.current, new Promise((r) => setTimeout(r, 2500))])]);
    recognitionRef.current = null;
    recorderRef.current = null;
    const s = session.current;
    const seconds = (performance.now() - s.startedAt) / 1000;
    releaseMic();
    setRecording(false);

    const transcript = [...s.finals, s.interim].join(" ").replace(/\s+/g, " ").trim();
    return {
      url: audio && s.chunks.length ? URL.createObjectURL(new Blob(s.chunks, { type: recorder?.mimeType || "audio/webm" })) : null,
      transcript,
      recognitionError: support.recognition ? s.error : "这个浏览器不支持语音识别（建议用 Chrome）。",
      seconds,
      speakingSeconds: levels ? s.speakingMs / 1000 : null,
      pauses: levels ? s.pauses : [],
    };
  }, [audio, levels, releaseMic, support.recognition]);

  return { start, stop, recording, interim, support };
}

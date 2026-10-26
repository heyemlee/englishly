// Same origin: next.config.ts proxies /api to the backend (or the backend serves these pages itself). Set
// NEXT_PUBLIC_API_BASE only to bypass the proxy.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

/** The practice page of an episode, opened at sentence `sentenceIdx` if given. */
export function episodeHref(id: number, sentenceIdx?: number | null): string {
  return `/episode?id=${id}${sentenceIdx === undefined || sentenceIdx === null ? "" : `&s=${sentenceIdx}`}`;
}

// An expression the learner picked out of a sentence, with its meaning in their own words.
export type Chunk = { id: number; pattern: string; meaning_zh: string };

export type Annotation = {
  id: number;
  sentence_id: number;
  kind: "word" | "phrase" | "expression";
  start: number;
  end: number;
  text: string;
  meaning_zh: string;
  usage_zh: string;
  example_en: string;
  example_zh: string;
};

export type ClipLesson = { clip: number; title: string; summary: string; goal: string };

export type LearningProgress = {
  heard_count: number;
  studied_count: number;
  listening_seconds: number;
  last_sentence_idx: number | null;
  last_activity_at: string | null;
};

export type ListeningEvent = { id: string; sentence_id: number; start: number; end: number; seconds: number };

export type Sentence = {
  id: number;
  idx: number;
  clip: number;
  start: number;
  end: number;
  text: string;
  translation_zh: string | null; // saved Chinese translation, null until supplied
  annotations: Annotation[];
  heard: boolean;
  dictation_score: number | null;
  shadow_score: number | null;
  saved: Chunk[];
};

type EpisodeBase = {
  id: number;
  video_id: string; // YouTube id, or "podcast:<hash>"
  title: string;
  channel: string | null;
  caption_kind: "manual" | "generated" | "whisper";
  segmented_by: "punctuation" | "claude" | "fallback" | "whisper";
  created_at: string;
  source: "youtube" | "podcast";
  image_url: string | null;
  status: "ready" | "processing" | "failed";
  status_detail: string;
  channel_url: string | null; // YouTube channel, once known
  // A YouTube video's audio downloaded for precise times and offline playback (podcasts always have audio).
  audio_status: "" | "processing" | "ready" | "failed";
  audio_detail: string;
  has_audio: boolean;
  video_status: "" | "processing" | "ready" | "failed";
  video_detail: string;
};

export type EpisodeSummary = EpisodeBase & LearningProgress & {
  feed_url: string | null;
  sentence_count: number;
  clip_count: number;
  duration: number;
  practiced_count: number;
  last_practiced_at: string | null; // 'YYYY-MM-DD HH:MM:SS' UTC
};

export type EpisodeDetail = EpisodeBase & LearningProgress & {
  has_video: boolean;
  sentences: Sentence[];
  lessons: ClipLesson[];
  warning?: string | null;
};

export type SavedChunk = Chunk & {
  id: number;
  sentence_id: number | null;
  created_at: string;
  sentence_text: string | null;
  sentence_idx: number | null;
  start_s: number | null;
  end_s: number | null;
  episode_id: number | null;
  video_id: string | null;
  episode_title: string | null;
  source: "youtube" | "podcast" | null;
  has_audio: boolean;
  entry_source: "subtitle" | "manual";
  context_en: string;
  context_zh: string;
  source_label: string;
  notes: string;
  in_review: boolean;
};

export type ManualChunkIn = {
  pattern: string;
  meaning_zh: string;
  context_en: string;
  context_zh: string;
  source_label: string;
  notes: string;
  add_to_review: boolean;
};

export type AttemptIn = {
  sentence_id: number;
  kind: "dictation" | "shadow";
  user_text: string;
  score: number;
  details?: Record<string, unknown>;
};

export type CardKind = "produce" | "listen" | "cloze";

export type ReviewCard = {
  id: number;
  kind: CardKind;
  source: "chunk" | "phrase" | "talk" | "retell" | "manual";
  prompt_zh: string;
  answer_en: string;
  hint: string;
  is_new: boolean;
  intervals: Record<"1" | "2" | "3" | "4", string>;
  origin: { pattern: string; sentence: string | null; sentence_idx: number | null; episode_id: number | null; title: string | null } | null;
  // listen cards made from a sentence: play this range of the original recording (otherwise read answer_en aloud)
  listen: {
    episode_id: number;
    video_id: string;
    source: "youtube" | "podcast";
    audio: boolean; // a local audio file to play (podcasts, downloaded YouTube audio); else the YouTube player
    start: number;
    end: number;
    sentence_idx: number;
  } | null;
  // cloze cards: the answer sentence as tokens, the expression's words marked as blanks
  cloze: { text: string; blank: boolean; before: string; after: string }[] | null;
};

export type ReviewSummary = {
  due: number;
  new_available: number;
  new_total: number;
  reviewed_today: number;
  total: number;
  next_due: string | null; // 'YYYY-MM-DD HH:MM:SS' UTC
  kinds: CardKind[]; // which card kinds are being reviewed
};

export type QueueState = { summary: ReviewSummary; card: ReviewCard | null };

export type CardRow = {
  id: number;
  kind: CardKind;
  source: string;
  prompt_zh: string;
  answer_en: string;
  hint: string;
  due: string;
  state: number;
  reps: number;
};

export type RetellRound = {
  limit_seconds: number;
  total_seconds: number;
  speaking_seconds: number | null;
  transcript: string;
  words: number;
  wpm: number;
  pauses: number;
  longest_pause: number;
};

export type Retell = {
  id: number;
  episode_id: number | null;
  clip_idx: number | null;
  topic: string;
  title: string | null;
  rounds: RetellRound[];
  created_at: string;
};

export type Health = {
  ok: boolean;
  cloud: boolean; // running on a cloud server: importing happens on the Mac
  login: boolean; // a password protects the API
  whisper: { available: boolean; reason: string; model: string };
};

export type YouTubeChannel = {
  title: string;
  url: string;
  image: string | null;
  videos: { video_id: string; title: string; duration: number | null; views: number | null; episode_id: number | null }[];
};

export type PodcastShow = { title: string; author: string; feed_url: string; image: string | null; episodes: number | null };

export type PodcastFeed = {
  title: string;
  author: string;
  image: string | null;
  feed_url: string;
  episodes: {
    guid: string;
    title: string;
    published: string | null;
    duration: number | null;
    audio_url: string;
    image: string | null;
    description: string;
    episode_id: number | null;
  }[];
};

export type DailyStat = {
  listening_seconds: number;
  date: string;
  dictation: number;
  dictation_avg: number | null;
  shadow: number;
  shadow_avg: number | null;
  reviews: number;
  sentences: number;
};

export type Stats = {
  streak: number;
  active_days: number;
  totals: {
    listening_seconds: number;
    sentences_heard: number;
    episodes: number;
    sentences_practiced: number;
    dictations: number;
    shadows: number;
    cards: number;
    cards_new: number;
    cards_learning: number;
    cards_mature: number;
    reviews: number;
    retells: number;
  };
  recent: { dictation: number | null; dictation_prev: number | null; shadow: number | null; shadow_prev: number | null };
  daily: DailyStat[];
  retells: { id: number; created_at: string; title: string | null; wpm: number[]; pauses: number[] }[];
};

export type MishearExample = { sentence: string; got: string | null; episode_id: number; sentence_idx: number; title: string };

export type Mishears = {
  total: number;
  attempts: number;
  function_share: number | null;
  top: {
    word: string;
    count: number;
    missed: number;
    function_word: boolean;
    heard_as: { text: string; count: number }[];
    examples: MishearExample[];
  }[];
  recent: (MishearExample & { expected: string; created_at: string })[];
};

export type MishearQuestion = {
  sentence_id: number;
  sentence_idx: number;
  text: string;
  start_s: number;
  end_s: number;
  episode_id: number;
  title: string;
  source: "youtube" | "podcast";
  video_id: string;
  has_audio: boolean;
  before_score: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("连不上服务器，检查网络。");
  }
  if (res.status === 401 && path !== "/api/login" && typeof window !== "undefined") {
    // A password protects this server: log in, then come back here.
    const here = window.location.pathname + window.location.search;
    // A full page load on purpose: this runs outside React, and it drops whatever the page had loaded.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (window.location.pathname !== "/login") window.location.href = `/login?next=${encodeURIComponent(here)}`;
    throw new Error("请先登录。");
  }
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Not our JSON: the proxy couldn't reach the backend.
      if (res.status >= 500) message = "后端没有响应：确认 PodEcho 的后台服务在运行（端口 8811）。";
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  health: () => request<Health>("/api/health"),
  login: (password: string) => request<{ ok: boolean }>("/api/login", { method: "POST", body: json({ password }) }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST" }),
  searchPodcasts: (q: string) => request<PodcastShow[]>(`/api/podcasts/search?q=${encodeURIComponent(q)}`),
  podcastFeed: (url: string) => request<PodcastFeed>(`/api/podcasts/feed?url=${encodeURIComponent(url)}`),
  importPodcast: (feed_url: string, guid: string) =>
    request<{ id: number }>("/api/podcasts/import", { method: "POST", body: json({ feed_url, guid }) }),
  retryEpisode: (id: number) => request<{ ok: boolean }>(`/api/episodes/${id}/retry`, { method: "POST" }),
  youtubeChannel: (url: string) => request<YouTubeChannel>(`/api/youtube/channel?url=${encodeURIComponent(url)}`),
  downloadAudio: (id: number) => request<{ ok: boolean }>(`/api/episodes/${id}/audio`, { method: "POST" }),
  prepareVideo: (id: number) => request<{ ok: boolean }>(`/api/episodes/${id}/video`, { method: "POST" }),
  episodes: () => request<EpisodeSummary[]>("/api/episodes"),
  importEpisode: (url: string) => request<EpisodeDetail>("/api/episodes", { method: "POST", body: json({ url }) }),
  episode: (id: number) => request<EpisodeDetail>(`/api/episodes/${id}`),
  savePosition: (id: number, sentence_id: number) => request<{ ok: boolean }>(`/api/episodes/${id}/position`, {
    method: "PUT", body: json({ sentence_id }), keepalive: true,
  }),
  saveListening: (id: number, events: ListeningEvent[], keepalive = false) => request<LearningProgress>(`/api/episodes/${id}/listening`, {
    method: "POST", body: json({ events }), keepalive,
  }),
  deleteEpisode: (id: number) => request<{ ok: boolean }>(`/api/episodes/${id}`, { method: "DELETE" }),
  updateTiming: (sentenceId: number, patch: { start?: number; end?: number }) =>
    request<{ id: number; start: number; end: number }>(`/api/sentences/${sentenceId}`, {
      method: "PATCH",
      body: json(patch),
    }),
  saveAttempt: (attempt: AttemptIn) => request<{ id: number }>("/api/attempts", { method: "POST", body: json(attempt) }),
  chunks: () => request<SavedChunk[]>("/api/chunks"),
  saveChunk: (sentence_id: number, pattern: string, meaning_zh: string) =>
    request<Chunk>("/api/chunks", { method: "POST", body: json({ sentence_id, pattern, meaning_zh }) }),
  addManualChunk: (body: ManualChunkIn) => request<Chunk>("/api/chunks/manual", { method: "POST", body: json(body) }),
  enrollChunk: (id: number) => request<{ ok: boolean }>(`/api/chunks/${id}/review`, { method: "POST" }),
  updateChunk: (id: number, meaning_zh: string) => request<Chunk>(`/api/chunks/${id}`, { method: "PATCH", body: json({ meaning_zh }) }),
  deleteChunk: (id: number) => request<{ ok: boolean }>(`/api/chunks/${id}`, { method: "DELETE" }),

  reviewQueue: () => request<QueueState>("/api/review"),
  setReviewKinds: (kinds: CardKind[]) => request<QueueState>("/api/review/kinds", { method: "PUT", body: json({ kinds }) }),
  review: (cardId: number, body: { rating: number; said?: string; score?: number | null }) =>
    request<QueueState>(`/api/review/${cardId}`, { method: "POST", body: json(body) }),
  cards: () => request<CardRow[]>("/api/cards"),
  deleteCard: (id: number) => request<{ ok: boolean }>(`/api/cards/${id}`, { method: "DELETE" }),

  retells: () => request<Retell[]>("/api/retells"),
  stats: () => request<Stats>("/api/stats"),
  mishears: () => request<Mishears>("/api/mishears"),
  mishearPractice: (word = "") => request<{ items: MishearQuestion[] }>(`/api/mishears/practice?word=${encodeURIComponent(word)}`),
  saveRetell: (body: { episode_id?: number | null; clip_idx?: number | null; topic?: string; rounds: RetellRound[] }) =>
    request<Retell>("/api/retells", { method: "POST", body: json(body) }),
};

export const mediaUrl = (episodeId: number) => `${API_BASE}/api/media/${episodeId}`;
export const videoUrl = (episodeId: number) => `${API_BASE}/api/video/${episodeId}`;


export const thumbnail = (ep: { source: string; video_id: string; image_url: string | null }) =>
  ep.source === "podcast" ? ep.image_url : `https://i.ytimg.com/vi/${ep.video_id}/mqdefault.jpg`;

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Per-viewer conveniences only; storage can be unavailable (private mode, blocked site data).
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

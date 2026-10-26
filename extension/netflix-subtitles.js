// MAIN world. Only official timed-text metadata/documents leave this module; no account, audio, video or licence data.
(() => {
  if (window.__podechoOfficialSubtitles) return;
  window.__podechoOfficialSubtitles = true;
  const C = globalThis.PodechoStreaming;
  const originalParse = JSON.parse;
  const originalFetch = window.fetch;
  const cache = new Map();
  const currentId = () => location.pathname.match(/^\/watch\/(\d{1,20})\/?$/)?.[1] || null;
  const pending = new Map();
  const post = (value) => window.postMessage({ channel: "podecho:netflix:subtitles", ...value }, location.origin);
  const officialUrl = (raw) => {
    try {
      const url = new URL(raw);
      return url.protocol === "https:" && !url.username && !url.password && !url.port
        && /(^|\.)(netflix\.com|nflxvideo\.net|nflxext\.com)$/.test(url.hostname) ? url.href : null;
    } catch { return null; }
  };
  function movie(id) {
    if (!/^\d{1,20}$/.test(String(id))) return null;
    if (!cache.has(String(id))) {
      if (cache.size >= 4) cache.delete(cache.keys().next().value);
      cache.set(String(id), { tracks: new Map(), cues: new Map() });
    }
    return cache.get(String(id));
  }
  function player() {
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI()?.videoPlayer;
      const ids = api?.getAllPlayerSessionIds?.() || [];
      const id = ids.find((id) => String(id).includes("watch")) || ids[0];
      const p = id ? api.getVideoPlayerBySessionId(id) : null;
      const reported = p?.getMovieId?.();
      if (reported !== undefined && reported !== null && String(reported) !== currentId()) return null;
      return p;
    } catch { return null; }
  }
  function normalize(track) {
    if (!track || track.isNoneTrack || track.isForcedNarrative || /forced/i.test(track.rawTrackType || "")) return null;
    const label = String(track.languageDescription || track.displayName || track.label || "").slice(0, 200);
    const language = C.subtitleLanguage(track.language || track.bcp47 || track.bcp47Language || "", label);
    if (!language) return null;
    const downloads = [];
    for (const [format, value] of Object.entries(track.ttDownloadables || track.downloadables || {})) {
      if (!/vtt|imsc|dfxp|simple|ttml/i.test(format)) continue;
      for (const candidate of [...Object.values(value?.downloadUrls || {}), ...(Array.isArray(value?.urls) ? value.urls.map((x) => x.url) : [])]) {
        const url = officialUrl(candidate);
        if (url) { downloads.push({ url, format }); break; }
      }
    }
    downloads.sort((a, b) => Number(!/vtt/i.test(a.format)) - Number(!/vtt/i.test(b.format)));
    const id = String(track.trackId || track.timedtextTrackId || track.id || `${language}:${label}`).slice(0, 180);
    return { id, language, label: label || language, downloads: downloads.slice(0, 3), raw: track };
  }
  function remember(id, tracks) {
    const entry = movie(id); if (!entry || !Array.isArray(tracks)) return;
    for (const track of tracks.slice(0, 200)) {
      const t = normalize(track); if (!t) continue;
      const old = entry.tracks.get(t.id);
      entry.tracks.set(t.id, { ...old, ...t, downloads: t.downloads.length ? t.downloads : old?.downloads || [] });
    }
  }
  function readManifest(value) {
    // Known playback envelopes only. Never recursively enumerate account objects or inspect DRM fields.
    for (const v of [value, value?.result, value?.data, value?.value, value?.result?.manifest]) {
      if (!v || typeof v !== "object") continue;
      const tracks = v.timedtexttracks || v.textTracks;
      const id = v.movieId || v.videoId || v.movieID;
      if (Array.isArray(tracks) && /^\d{1,20}$/.test(String(id))) remember(String(id), tracks);
    }
  }
  JSON.parse = function (...args) {
    const value = Reflect.apply(originalParse, this, args);
    try {
      if (typeof args[0] === "string" && /"(?:timedtexttracks|textTracks)"\s*:/.test(args[0])) readManifest(value);
    } catch { /* never change the host parser's result or exceptions */ }
    return value;
  };
  function available(id) {
    const p = player();
    try { remember(id, p?.getTimedTextTrackList?.()); } catch { /* manifest path may still work */ }
    return movie(id);
  }
  function languageNow() {
    try { const t = player()?.getTimedTextTrack?.(); return normalize(t); } catch { return null; }
  }
  function saveDocument(id, track, text) {
    const entry = movie(id); if (!entry || !track || !text) return;
    const cues = C.parseTimedText(text, { tickRate: 10000000 });
    entry.tracks.set(track.id, { ...entry.tracks.get(track.id), ...track });
    entry.cues.set(track.id, cues);
  }
  async function boundedText(response) {
    if (!response.ok || +(response.headers.get("content-length") || 0) > 5 * 1024 * 1024) throw new Error("官方字幕暂时无法读取。");
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > 5 * 1024 * 1024) throw new Error("官方字幕文件过大。");
        chunks.push(value);
      }
    } catch (e) { await reader.cancel().catch(() => {}); throw e; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
    return new TextDecoder().decode(bytes);
  }
  async function fetchTrack(id, track) {
    const entry = movie(id);
    if (entry.cues.has(track.id)) return;
    const key = `${id}:${track.id}`;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      for (const { url } of track.downloads) {
        try {
          const r = await Reflect.apply(originalFetch, window, [url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(4000) }]);
          saveDocument(id, track, await boundedText(r)); return;
        } catch { /* next official text representation; never try a video URL */ }
      }
    })().finally(() => pending.delete(key));
    pending.set(key, task); return task;
  }
  function knownTrack(id, rawUrl) {
    const url = officialUrl(rawUrl); if (!url) return null;
    return [...(movie(id)?.tracks.values() || [])].find((t) => t.downloads.some((d) => d.url === url)) || null;
  }
  function textDocument(url, type) {
    return officialUrl(url) && (/^(text\/vtt|application\/(ttml|dfxp)\+xml|text\/xml|application\/xml)(;|$)/i.test(type)
      || /\.(vtt|ttml|dfxp|xml)(?:\?|$)/i.test(url));
  }
  // Observe only text subtitle responses the page already requested. Never read a media/octet-stream body unless
  // its exact URL was identified in timed-text metadata. Snapshots bind to the movie/language at request time.
  window.fetch = function (...args) {
    const id = currentId(), url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    const track = id && (knownTrack(id, url) || languageNow());
    const result = Reflect.apply(originalFetch, this, args);
    if (id && track && officialUrl(url)) result.then((r) => {
      if (knownTrack(id, url) || textDocument(url, r.headers.get("content-type") || "")) {
        void boundedText(r.clone()).then((text) => saveDocument(id, track, text)).catch(() => {});
      }
    }).catch(() => {});
    return result;
  };
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function (...args) {
    requests.set(this, { id: currentId(), url: String(args[1]) });
    return Reflect.apply(open, this, args);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const req = requests.get(this), track = req?.id && (knownTrack(req.id, req.url) || languageNow());
    if (track && officialUrl(req.url)) this.addEventListener("load", () => {
      try {
        if (requests.get(this) === req && (this.responseType === "" || this.responseType === "text") && this.status === 200
            && (knownTrack(req.id, req.url) || textDocument(req.url, this.getResponseHeader("content-type") || ""))) {
          saveDocument(req.id, track, this.responseText);
        }
      } catch { /* original XHR remains untouched */ }
    }, { once: true });
    return Reflect.apply(send, this, args);
  };

  function choose(entry, preference) {
    const tracks = [...entry.tracks.values()];
    const english = tracks.filter((t) => t.language === "en");
    const active = languageNow();
    const en = english.find((t) => t.id === active?.id) || english[0];
    const zh = tracks.find((t) => t.language === preference) || tracks.find((t) => t.language === "zh") || tracks.find((t) => t.language.startsWith("zh"));
    return [en, zh].filter(Boolean);
  }
  let warming = false;
  async function warmTracks(id, selected) {
    const p = player();
    if (!p?.setTimedTextTrack || !p?.getTimedTextTrack || warming) return;
    const original = p.getTimedTextTrack();
    if (!original) return; // don't alter the user's subtitle setting if it cannot be restored
    const v = [...document.querySelectorAll("video")].find((v) => v.offsetWidth > 0);
    const wasPlaying = v && !v.paused;
    let restored = true;
    warming = true;
    try {
      if (wasPlaying) await p.pause();
      for (const track of selected) {
        if (currentId() !== id) break;
        if (movie(id).cues.has(track.id)) continue;
        await p.setTimedTextTrack(track.raw);
        // Native player now requests its official subtitle document; the narrow observer above caches it.
        for (let i = 0; i < 32 && currentId() === id && !movie(id).cues.has(track.id); i++) await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      if (currentId() === id) {
        try { await p.setTimedTextTrack(original); } catch { restored = false; }
        if (wasPlaying && restored) try { await p.play(); } catch { /* never force past an autoplay error */ }
      }
      warming = false;
    }
    return restored;
  }
  window.addEventListener("message", async (event) => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.channel !== "podecho:netflix:subtitle-request"
      || !["inspect", "prepare"].includes(m.action) || typeof m.requestId !== "string" || m.requestId.length > 100
      || m.mediaId !== currentId() || !["zh-Hans", "zh-Hant"].includes(m.language)) return;
    const id = currentId();
    try {
      const entry = available(id), selected = choose(entry, m.language);
      await Promise.all(selected.map((t) => fetchTrack(id, t)));
      const restored = m.action === "prepare" && currentId() === id ? await warmTracks(id, selected) : true;
      if (currentId() !== id) return;
      const tracks = selected.map((t) => ({ id: t.id, language: t.language, label: t.label, cues: entry.cues.get(t.id) || [] }));
      post({ requestId: m.requestId, mediaId: id, tracks, languages: [...new Set([...entry.tracks.values()].map((t) => t.language))],
        ...(restored === false ? { error: "双字幕已读取，但官网字幕未能恢复，请手动切回原来的字幕。" } : {}) });
    } catch {
      post({ requestId: m.requestId, mediaId: id, tracks: [], error: "官方字幕暂时无法读取，请刷新播放页后重试。" });
    }
  });
})();

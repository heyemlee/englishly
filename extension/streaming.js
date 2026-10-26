// On-site companion. Reads standard text tracks / rendered captions only; no media downloads or account access.
(() => {
  if (window.__podechoStreamingLoaded) return;
  window.__podechoStreamingLoaded = true;
  const C = globalThis.PodechoStreaming;
  const api = (path, method, body) => chrome.runtime.sendMessage({ type: "api", path, method, body });
  const prefs = { loop: false, autoPause: false, showText: true, collapsed: false, chinese: "zh-Hans" };
  const state = { ref: null, store: new C.CueStore(), observer: new C.ObservedCaptions(), current: null,
    video: null, locked: null, pausedKey: null, controlling: false, loaded: false, playing: false,
    lastTime: 0, lastTitle: "", lastRender: "", expectedSeek: null, generation: 0, imported: false,
    chinese: new Map(), subtitleBusy: false, subtitleStatus: "", lastSubtitleRequest: 0 };
  const sessions = new Map();
  const host = document.createElement("div");
  host.id = "podecho-streaming-root";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel { position: fixed; right: 16px; bottom: 20px; z-index: 2147483647; width: 380px;
        max-width: calc(100vw - 32px); max-height: calc(100vh - 40px); overflow-y: auto;
        color: #ededed; background: linear-gradient(150deg, #ffffff10, transparent 45%), #1e1e20d9;
        border: 1px solid #ffffff26; border-radius: 24px; box-shadow: inset 0 1px 0 #ffffff14, 0 20px 48px -12px #0008;
        backdrop-filter: blur(28px) saturate(180%); -webkit-backdrop-filter: blur(28px) saturate(180%);
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
        -webkit-font-smoothing: antialiased; color-scheme: dark; }
      header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
      strong { font-weight: 600; } .brand { letter-spacing: -.02em; }
      .logo { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 8px; background: #ededed; color: #0d0d0d; font-weight: 700; }
      .site { flex: 1; color: #aaa; font-size: 12px; }
      .body { display: grid; gap: 12px; padding: 0 14px 14px; }
      .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #aaa; font-size: 12px; }
      .sentence { font-size: 17px; white-space: pre-line; line-height: 1.6; min-height: 2em; user-select: text; }
      .translation { color: #bbb; font-size: 14px; white-space: pre-line; }
      .muted, .status, .hint { color: #aaa; font-size: 12px; } .error { color: #ff6b61; }
      .row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
      button, select, .file { border: 0; border-radius: 999px; background: #ffffff14; color: #ededed;
        font: inherit; font-size: 12px; padding: 6px 12px; cursor: pointer; }
      button:hover, .file:hover { background: #ffffff24; } button:disabled { opacity: .35; cursor: default; }
      button.primary { background: #ededed; color: #0d0d0d; }
      .controls { display: flex; gap: 6px; } .controls button { height: 40px; } .controls .primary { flex: 1; font-size: 14px; }
      .ghost { background: transparent; padding: 4px 8px; }
      .chips label { position: relative; padding: 5px 10px; border-radius: 999px; background: #ffffff14; color: #aaa; font-size: 12px; cursor: pointer; }
      .chips input { position: absolute; opacity: 0; width: 1px; height: 1px; }
      .chips label:has(:checked) { background: #ededed; color: #0d0d0d; }
      .chips label:has(:focus-visible), button:focus-visible, select:focus-visible, .file:focus-within { outline: 2px solid #ededed; outline-offset: 2px; }
      .file input { display: none; } .file { display: inline-block; }
      .file:focus-within { outline: 2px solid #ededed; }
      .foot { display: flex; justify-content: space-between; gap: 6px; align-items: center; }
      .keys { display: none; color: #777; font-size: 11px; }
      @media (pointer: fine) { .keys { display: inline; } }
      form, .explanation { border-top: 1px solid #ffffff24; padding-top: 10px; display: grid; gap: 8px; }
      form label { font-size: 12px; color: #aaa; }
      form input[type=text] { display: block; width: 100%; margin-top: 4px; padding: 8px 12px; border: 1px solid #ffffff18;
        border-radius: 12px; color: #ededed; background: #ffffff14; font: inherit; font-size: 16px; }
      form input:focus { outline: 1px solid #ededed; }
      form .check { display: flex; align-items: center; gap: 6px; }
      .annotation { padding: 0; display: inline; border-radius: 3px; background: #b7e4c733; border-bottom: 2px solid #3fb950;
        font: inherit; color: inherit; text-align: inherit; user-select: text; }
      .annotation:hover { background: #b7e4c74d; }
      .collapsed { width: auto; } .collapsed .body { display: none; }
      [hidden] { display: none !important; }
    </style>
    <section class="panel" hidden aria-label="PodEcho 官网学习助手">
      <header><span class="logo">P</span><strong class="brand">PodEcho</strong><span class="site"></span>
        <button class="ghost" data-act="collapse" title="收起" aria-label="收起">⌄</button></header>
      <div class="body">
        <div class="title"></div>
        <div class="sentence muted">在官网开启英文字幕后播放，或导入 SRT／VTT。</div>
        <div class="translation" hidden></div>
        <div class="controls">
          <button data-act="prev" title="上一句（A）" aria-label="上一句">‹</button>
          <button class="primary" data-act="replay" title="重播（S）">重播</button>
          <button data-act="next" title="下一句（D）；只能跳到已读取或导入的字幕" aria-label="下一句">›</button>
        </div>
        <div class="row chips">
          <label><input type="checkbox" data-opt="loop">单句循环</label>
          <label><input type="checkbox" data-opt="autoPause">句后暂停</label>
          <label title="仅隐藏插件字幕；官网字幕由官网控制，关闭后可能无法读取"><input type="checkbox" data-opt="showText">字幕</label>
          <select aria-label="倍速" data-part="rate"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select>
          <select aria-label="中文字幕" data-part="chinese" title="优先使用已保存的中文；否则显示官方中文轨。缺少所选中文版本时使用其他可用中文，并在提示中标明。"><option value="zh-Hans">中文：简体</option><option value="zh-Hant">中文：繁體</option><option value="off">中文：关闭</option></select>
        </div>
        <div class="row">
          <button data-act="save" title="选中字幕里的表达后收藏，或收藏整句">收藏表达</button>
          <button data-act="subtitles" title="读取官方双字幕。必要时会暂时暂停并加载两条字幕，再恢复官网原来的字幕和播放状态。">读取双字幕</button>
          <button data-act="resume" hidden>继续上次</button>
          <label class="file" title="字幕版本需要与当前影片一致">导入字幕<input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" data-part="file"></label>
        </div>
        <form hidden>
          <label>英文<input type="text" name="pattern" required maxlength="200" autocomplete="off"></label>
          <label>中文释义<input type="text" name="meaning" required maxlength="200" autocomplete="off"></label>
          <label class="check"><input type="checkbox" name="review" checked>加入复习</label>
          <div class="row"><button type="submit" class="primary">保存到单词本</button><button type="button" data-act="cancel">取消</button></div>
          <div class="form-status status" role="status"></div>
        </form>
        <div class="explanation" hidden></div>
        <div class="status" data-part="status" role="status"></div>
        <div class="hint" title="网页字幕只能边看边记录；精确逐句控制请导入字幕或使用网页提供的完整时间轨道"></div>
        <div class="foot"><div class="row"><button class="ghost" data-act="refresh" title="Codex 保存中文讲解后点这里">刷新讲解</button>
          <button class="ghost" data-act="history">学习记录 ↗</button><button class="ghost" data-act="settings" aria-label="插件设置" title="插件设置">⚙</button></div>
          <span class="keys" title="A 上一句 · S 重播 · D 下一句 · R 循环">A S D R</span></div>
      </div>
    </section>`;
  const $ = (s) => root.querySelector(s);
  const panel = $(".panel");
  document.documentElement.append(host);
  function notice(text, error = false) {
    const el = $('[data-part="status"]'); el.textContent = text; el.className = error ? "status error" : "status";
  }
  const pathFor = (ref) => `/api/streaming/${ref.provider}/${ref.mediaId}`;
  const cacheKey = (ref) => `podechoStreaming:${ref.key}`;
  const title = () => (document.querySelector('[data-uia="video-title"], [data-testid="player-title"], .video-title')?.textContent?.trim()
    || document.title.replace(/\s*[-|]\s*(Netflix|Hulu).*$/i, "") || state.ref?.provider || "节目").slice(0, 300);
  const timeText = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function putChinese(map, track, cues, dirty = true) {
    if (!track.id || !["zh", "zh-Hans", "zh-Hant"].includes(track.language)) return;
    track = { ...track, id: String(track.id).slice(0, 180), label: String(track.label || track.language).slice(0, 200) };
    if (!map.has(track.id)) {
      if (map.size >= 8) return;
      map.set(track.id, { id: track.id, language: track.language, label: track.label || track.language, store: new C.CueStore() });
    }
    const saved = map.get(track.id);
    for (const c of cues.slice(0, 10000)) if (typeof c.text === "string" && c.text.length <= 5000) saved.store.put(c, dirty);
  }
  function loadChinese(map, records, dirty = true) {
    for (const c of records || []) putChinese(map, { id: c.track_id, language: c.language, label: c.label }, [c], dirty);
  }
  function chineseRecords(map, dirtyOnly = false) {
    return [...map.values()].flatMap((t) => (dirtyOnly ? [...t.store.dirty].map((k) => t.store.map.get(k)) : t.store.list())
      .map((cue) => ({ track: t, cue })));
  }
  const wireChinese = ({ track, cue }) => ({ track_id: track.id, language: track.language, label: track.label,
    key: cue.key, start: cue.start, end: cue.end, text: cue.text, timing: "exact" });
  function translationFor(cue) {
    if (!cue || prefs.chinese === "off") return { text: "", source: "" };
    if (cue.translation_zh) return { text: cue.translation_zh, source: "已保存中文" };
    const tracks = [...state.chinese.values()].filter((t) => t.store.map.size);
    const track = tracks.find((t) => t.language === prefs.chinese) || tracks.find((t) => t.language === "zh") || tracks[0];
    return { text: track ? C.alignedChinese(cue, track.store.list(), state.video?.currentTime || cue.start) : "",
      source: track ? `官方字幕 · ${track.label}` : "" };
  }

  const subtitleRequests = new Map();
  window.addEventListener("message", (event) => {
    const value = event.data;
    if (event.source !== window || event.origin !== location.origin || value?.channel !== "podecho:netflix:subtitles") return;
    const done = subtitleRequests.get(value.requestId);
    if (done) { subtitleRequests.delete(value.requestId); done(value); }
  });
  async function readOfficial(action = "inspect") {
    if (state.ref?.provider !== "netflix" || state.subtitleBusy || prefs.chinese === "off") return;
    if (action === "prepare" && advert()) return notice("广告播放期间暂停双字幕加载。");
    const generation = state.generation, ref = state.ref, requestId = crypto.randomUUID(), requestedLanguage = prefs.chinese;
    state.subtitleBusy = true; state.lastSubtitleRequest = performance.now();
    $('[data-act="subtitles"]').disabled = true;
    if (action === "prepare") notice("正在读取官方双字幕…");
    try {
      const response = await new Promise((resolve) => {
        const timer = setTimeout(() => { subtitleRequests.delete(requestId); resolve(null); }, 25000);
        subtitleRequests.set(requestId, (r) => { clearTimeout(timer); resolve(r); });
        window.postMessage({ channel: "podecho:netflix:subtitle-request", requestId, action, mediaId: ref.mediaId,
          language: requestedLanguage }, location.origin);
      });
      if (generation !== state.generation) return;
      if (!response) {
        state.subtitleStatus = "官方字幕连接超时";
        if (action === "prepare") notice("读取超时，请重新加载插件并刷新 Netflix 播放页。", true);
        render(true); return;
      }
      if (response.mediaId !== ref.mediaId) return;
      for (const track of (response?.tracks || []).slice(0, 2)) {
        if (!Array.isArray(track.cues) || track.cues.length > 10000) continue;
        if (track.language === "en" && !state.imported) {
          for (const c of track.cues) if (typeof c.text === "string" && c.text.length <= 5000) state.store.put(c);
        } else putChinese(state.chinese, track, track.cues);
      }
      const hasChinese = [...state.chinese.values()].some((t) => t.store.map.size);
      state.subtitleStatus = hasChinese ? "" : response?.languages?.some((l) => /^zh/.test(l)) ? "中文轨尚未载入" : "尚未读到中文轨";
      if (action === "prepare") {
        notice(response?.error || (hasChinese ? "已读取官方中文字幕" : "尚未读到中文，请在官网分别选一次英文和中文字幕后重试。"), Boolean(response?.error) || !hasChinese);
        const session = sessions.get(ref.key); if (session) void persist(session, false);
      }
      render(true);
    } finally {
      if (generation === state.generation) {
        state.subtitleBusy = false; $('[data-act="subtitles"]').disabled = prefs.chinese === "off";
        if (prefs.chinese !== requestedLanguage && prefs.chinese !== "off") void readOfficial();
      }
    }
  }

  function visible(el) { return el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden"; }
  function findVideo() {
    return [...document.querySelectorAll("video")].filter(visible)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
  }
  function advert() {
    return [...document.querySelectorAll('[data-testid="ad-countdown"], [data-uia="ad-break"], .AdUnitView, .ad-countdown')].some(visible);
  }

  const pendingControls = new Map();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "podecho:netflix:reply") return;
    const callback = pendingControls.get(event.data.id);
    if (callback) { pendingControls.delete(event.data.id); callback(event.data); }
  });
  async function control(action, extra = {}) {
    if (!state.ref || !state.video) throw new Error("请先在官网开始播放。");
    if (advert()) throw new Error("广告播放期间暂停逐句控制。");
    if (state.ref.provider === "netflix") {
      const id = crypto.randomUUID();
      const result = await new Promise((resolve) => {
        const timer = setTimeout(() => { pendingControls.delete(id); resolve({ ok: false, error: "播放器连接超时，请在扩展管理页重新加载插件并刷新官网。" }); }, 2000);
        pendingControls.set(id, (value) => { clearTimeout(timer); resolve(value); });
        window.postMessage({ channel: "podecho:netflix:command", id, mediaId: state.ref.mediaId, action, ...extra }, location.origin);
      });
      if (!result.ok) throw new Error(result.error || "播放器没有响应。");
    } else if (action === "seek") state.video.currentTime = extra.time;
    else if (action === "rate") state.video.playbackRate = extra.rate;
    else await state.video[action]();
  }

  async function go(cue) {
    if (!cue) return notice("这一句还没有读到；先播放，或导入完整字幕。", true);
    if (state.controlling) return;
    const generation = state.generation;
    state.controlling = true;
    try {
      state.expectedSeek = { time: Math.max(0, cue.start), until: performance.now() + 2500 };
      state.locked = cue.end > cue.start ? cue : null; state.pausedKey = null; state.current = cue;
      state.observer.reset();
      await control("seek", { time: Math.max(0, cue.start) });
      if (generation !== state.generation) return;
      await control("play"); render(true);
    } catch (e) { if (generation === state.generation) { state.locked = null; notice(e.message, true); } }
    finally { if (generation === state.generation) state.controlling = false; }
  }

  let lastTrackSignature = "", lastChineseSignature = "";
  const hiddenTracks = new Map();
  const previousEpisodeTracks = new WeakMap();
  const trackSignature = (t) => `${t.language}:${t.label}:${t.cues?.length}:${t.cues?.[0]?.startTime}:${t.cues?.[0]?.text}:${t.cues?.[t.cues.length - 1]?.endTime}:${t.cues?.[t.cues.length - 1]?.text}`;
  function releaseTracks() {
    for (const [track, previous] of hiddenTracks) if (track.mode === "hidden") track.mode = previous;
    hiddenTracks.clear();
  }
  function trackCaptions(v) {
    const all = [...(v.textTracks || [])].filter((t) => {
      if (!["captions", "subtitles"].includes(t.kind)) return false;
      if (previousEpisodeTracks.has(t)) {
        if (!t.cues?.length || previousEpisodeTracks.get(t) === trackSignature(t)) return false;
        previousEpisodeTracks.delete(t);
      }
      return true;
    });
    const language = (t) => C.subtitleLanguage(t.language, t.label);
    const english = all.filter((t) => t.mode !== "disabled" && (language(t) === "en" || (!t.language && !t.label && t.mode === "showing")));
    const chinese = all.filter((t) => language(t)?.startsWith("zh"));
    const track = english.find((t) => t.mode === "showing") || english[0];
    const secondary = chinese.find((t) => language(t) === prefs.chinese) || chinese.find((t) => language(t) === "zh") || chinese[0];
    // Standard HTML tracks can load in hidden mode while the website's visible English track stays unchanged.
    for (const t of [track, prefs.chinese === "off" ? null : secondary].filter(Boolean)) {
      if (t.mode === "disabled") { hiddenTracks.set(t, t.mode); t.mode = "hidden"; }
    }
    for (const [t, previous] of hiddenTracks) if (t !== track && (prefs.chinese === "off" || t !== secondary)) {
      if (t.mode === "hidden") t.mode = previous;
      hiddenTracks.delete(t);
    }
    if (secondary?.cues?.length && prefs.chinese !== "off") {
      const cues = secondary.cues;
      const signature = trackSignature(secondary);
      if (signature !== lastChineseSignature) {
        putChinese(state.chinese, { id: `native:${secondary.language}:${secondary.label}`.slice(0, 180), language: language(secondary), label: secondary.label },
          [...cues].slice(0, 10000).map((c) => ({ start: c.startTime, end: c.endTime, text: C.plain(c.text), timing: "exact" })));
        lastChineseSignature = signature; state.subtitleStatus = "";
      }
    }
    if (!track?.cues?.length) return false;
    const cues = track.cues;
    const signature = trackSignature(track);
    if (signature !== lastTrackSignature) {
      for (const c of [...cues].slice(0, 10000)) {
        const text = C.plain(c.text);
        if (text && text.length <= 5000) state.store.put({ start: c.startTime, end: c.endTime, text, timing: "exact" });
      }
      lastTrackSignature = signature;
    }
    return true;
  }
  function renderedCaption() {
    const selectors = state.ref?.provider === "netflix" ? [".player-timedtext .player-timedtext-text-container", ".player-timedtext"]
      : ['[data-testid="caption-text"]', '[data-testid="captions"]', ".captions-display", ".closed-caption", ".ClosedCaption", ".vjs-text-track-display"];
    for (const selector of selectors) {
      const el = [...document.querySelectorAll(selector)].find(visible);
      if (!el) continue;
      const text = (el.innerText || el.textContent || "").trim();
      // Do not silently mix a Chinese subtitle track into an English notebook.
      if (text.length <= 5000 && /[a-z]{2}/i.test(text) && !/[\u3400-\u9fff]/.test(text)) return text;
    }
    return "";
  }

  function render(force = false) {
    const c = state.current;
    const translated = translationFor(c);
    const signature = `${c?.key || c?.text || ""}:${translated.text}:${translated.source}:${JSON.stringify(c?.annotations)}:${prefs.showText}:${prefs.chinese}:${state.store.map.size}:${state.subtitleStatus}`;
    if (!force && signature === state.lastRender) return;
    state.lastRender = signature;
    const el = $(".sentence"); el.replaceChildren();
    if (!c) { el.textContent = state.store.map.size ? "当前没有字幕" : "在官网开启英文字幕后播放，或导入 SRT／VTT。"; el.className = "sentence muted"; }
    else if (!prefs.showText) { el.textContent = "字幕已隐藏"; el.className = "sentence muted"; }
    else {
      el.className = "sentence";
      const points = Array.from(c.text); let end = 0;
      for (const a of [...(c.annotations || [])].sort((a, b) => a.start - b.start)) {
        if (a.start < end || a.end > points.length || points.slice(a.start, a.end).join("") !== a.text) continue;
        el.append(document.createTextNode(points.slice(end, a.start).join("")));
        const b = document.createElement("button"); b.type = "button"; b.className = "annotation"; b.textContent = a.text;
        b.title = a.meaning_zh; b.addEventListener("click", () => explain(a, c)); el.append(b); end = a.end;
      }
      el.append(document.createTextNode(points.slice(end).join("")));
    }
    $(".translation").textContent = prefs.showText ? translated.text : "";
    $(".translation").title = prefs.showText ? translated.source : "";
    $(".translation").hidden = !prefs.showText || !translated.text;
    if (!prefs.showText) { $(".explanation").hidden = true; $("form").hidden = true; }
    $('[data-act="save"]').disabled = !c || !prefs.showText;
    $(".hint").textContent = `${state.store.map.size} 条字幕${c?.timing === "observed" || (!c?.key && c) ? " · 网页字幕时间为估计值" : ""}${state.subtitleStatus && prefs.chinese !== "off" ? ` · ${state.subtitleStatus}` : ""}`;
    $('[data-part="chinese"]').value = prefs.chinese;
    $('[data-act="subtitles"]').disabled = prefs.chinese === "off" || state.subtitleBusy;
    root.querySelectorAll("[data-opt]").forEach((box) => { box.checked = prefs[box.dataset.opt]; });
  }

  function explain(a, cue) {
    if (!prefs.showText) return;
    const el = $(".explanation"); el.replaceChildren(); el.hidden = false;
    for (const text of [a.meaning_zh, a.usage_zh, a.example_en, a.example_zh]) {
      if (text) { const p = document.createElement("div"); p.textContent = text; el.append(p); }
    }
    const save = document.createElement("button"); save.textContent = "收藏这个表达";
    save.addEventListener("click", () => openForm(a.text, a.meaning_zh, cue)); el.append(save);
  }

  let formContext = null;
  function openForm(pattern, meaning = "", cue = state.current) {
    if (!cue || !prefs.showText || !state.ref) return;
    formContext = { ref: { ...state.ref }, cue: { ...cue, translation_zh: translationFor(cue).text }, title: title() };
    const f = $("form"); f.hidden = false;
    f.elements.pattern.value = pattern.slice(0, 200); f.elements.meaning.value = meaning;
    $(".form-status").textContent = ""; f.elements.meaning.focus();
  }
  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!formContext) return;
    const context = formContext, f = e.target;
    const pattern = f.elements.pattern.value.trim(), meaning = f.elements.meaning.value.trim();
    if (!pattern || !meaning) return;
    const b = f.querySelector('[type="submit"]'); b.disabled = true;
    try {
      const response = await api("/api/chunks/manual", "POST", {
        pattern, meaning_zh: meaning, context_en: context.cue.text.slice(0, 1000), context_zh: (context.cue.translation_zh || "").slice(0, 1000),
        source_label: `${context.ref.provider === "netflix" ? "Netflix" : "Hulu"} · ${context.title}`.slice(0, 200),
        notes: `${context.ref.url}?podecho_t=${context.cue.start}\n${timeText(context.cue.start)}`, add_to_review: f.elements.review.checked,
      });
      if (formContext !== context) return;
      $(".form-status").textContent = response?.ok ? "已保存到单词本" : response?.data?.detail || response?.error || "保存失败，请启动 PodEcho 后重试。";
      if (response?.ok) { f.hidden = true; notice("已保存到单词本"); }
    } catch { if (formContext === context) $(".form-status").textContent = "插件已更新，请刷新官网后重试。"; }
    finally { b.disabled = false; }
  });

  function sessionSnapshot(session) {
    return { title: session.title, position: session.position, duration: session.duration,
      sentences: session.store.list(), resume: session.position, official_subtitles: chineseRecords(session.chinese).map(wireChinese) };
  }
  async function persist(session, report = true) {
    if (session.busy) { session.again = true; return; }
    session.busy = true;
    try {
      try { await chrome.storage.local.set({ [cacheKey(session.ref)]: sessionSnapshot(session) }); }
      catch { if (state.ref?.key === session.ref.key) notice("浏览器缓存已满；正在尝试保存到 PodEcho。", true); }
      const dirty = [...session.store.dirty].map((k) => session.store.map.get(k));
      const official = chineseRecords(session.chinese, true);
      // Bound each atomic API request; keep failed batches dirty for retry.
      for (let i = 0; i < Math.max(dirty.length, official.length, 1); i += 250) {
        const cues = dirty.slice(i, i + 250);
        const secondary = official.slice(i, i + 250);
        const response = await api(pathFor(session.ref), "PUT", {
          title: session.title, position: session.position, duration: session.duration,
          cues: cues.map(({ key, start, end, text, timing }) => ({ key, start, end, text, timing })),
          official_subtitles: secondary.map(wireChinese),
        });
        if (!response?.ok) {
          if (report && state.ref?.key === session.ref.key) notice(response?.status === 401 ? "访问密码不对，请打开插件设置。"
            : typeof response?.data?.detail === "string" ? response.data.detail : "尚未同步；启动 PodEcho 后会重试。", true);
          return;
        }
        for (const c of cues) if (session.store.map.get(c.key) === c) session.store.dirty.delete(c.key);
        for (const { track, cue } of secondary) if (track.store.map.get(cue.key) === cue) track.store.dirty.delete(cue.key);
      }
      if (report && state.ref?.key === session.ref.key) notice("学习记录已保存");
    } catch { if (report && state.ref?.key === session.ref.key) notice("尚未同步，请确认 PodEcho 和插件在运行。", true); }
    finally {
      session.busy = false;
      if (session.again) { session.again = false; void persist(session, report); }
    }
  }
  function updateSession() {
    const s = state.ref && sessions.get(state.ref.key);
    if (!s || !state.loaded || !state.video || !state.playing || advert()) return null;
    s.title = title(); s.position = Math.min(172800, Math.max(0, state.video.currentTime));
    s.duration = Number.isFinite(state.video.duration) ? Math.min(172800, state.video.duration) : 0;
    return s;
  }

  async function refresh() {
    if (!state.ref) return;
    const ref = state.ref, generation = state.generation;
    try {
      const r = await api(pathFor(ref));
      if (generation !== state.generation) return;
      if (!r?.ok) return notice(r?.status === 404 ? "还没有保存的讲解；先播放并同步字幕。" : "连不上 PodEcho，请检查插件设置。", true);
      for (const c of r.data.sentences) state.store.put(c, false);
      loadChinese(state.chinese, r.data.official_subtitles, false);
      state.current = state.current?.key ? state.store.map.get(state.current.key) : state.current;
      render(true); notice("已刷新保存的中文和重点");
    } catch { notice("刷新失败，请重新加载插件页面。", true); }
  }

  async function navigate() {
    const ref = C.reference(location.href);
    if (ref?.key === state.ref?.key) return;
    const old = state.ref && sessions.get(state.ref.key); if (old && state.playing) void persist(old);
    state.generation++; const generation = state.generation;
    for (const track of state.video?.textTracks || []) previousEpisodeTracks.set(track, trackSignature(track));
    releaseTracks();
    Object.assign(state, { ref, store: new C.CueStore(), current: null, locked: null, video: null, pausedKey: null,
      playing: false, loaded: false, lastTime: 0, imported: false, controlling: false, expectedSeek: null,
      chinese: new Map(), subtitleBusy: false, subtitleStatus: "", lastSubtitleRequest: 0 });
    state.observer.reset(); lastTrackSignature = ""; lastChineseSignature = "";
    $("form").hidden = true; $(".explanation").hidden = true; formContext = null;
    panel.hidden = !ref; if (!ref) return;
    $(".site").textContent = ref.provider === "netflix" ? "Netflix" : "Hulu";
    $(".title").textContent = title(); notice(""); render(true);
    let cached = {};
    try { cached = (await chrome.storage.local.get(cacheKey(ref)))[cacheKey(ref)] || {}; } catch { /* backend may still work */ }
    if (generation !== state.generation) return;
    const store = new C.CueStore();
    const chinese = new Map();
    // Cached cues may be from an offline session: retry all of them, without erasing server-side study fields.
    for (const c of cached.sentences || []) store.put(c);
    loadChinese(chinese, cached.official_subtitles);
    let remote = null;
    try { const r = await api(pathFor(ref)); if (r?.ok) remote = r.data; } catch { /* offline cache remains usable */ }
    if (generation !== state.generation) return;
    for (const c of remote?.sentences || []) store.put(c, false);
    loadChinese(chinese, remote?.official_subtitles, false);
    state.store = store; state.chinese = chinese; state.loaded = true;
    const resume = remote?.position ?? cached.position ?? 0;
    const requested = Number(new URL(location.href).searchParams.get("podecho_t"));
    const resumeTime = Number.isFinite(requested) && requested > 0 && requested < 172800 ? requested : resume;
    const session = { ref, store, chinese, title: title(), position: resume, duration: remote?.duration ?? cached.duration ?? 0,
      resume: resumeTime, busy: false, again: false };
    sessions.set(ref.key, session);
    const resumeButton = $('[data-act="resume"]'); resumeButton.hidden = resumeTime < 1;
    resumeButton.textContent = `继续 ${timeText(resumeTime)}`;
    render(true);
    void readOfficial();
  }

  async function boundary(v) {
    const c = state.locked;
    if (!c?.end || v.paused || v.seeking || state.controlling || v.currentTime < c.end - 0.03) return false;
    if (v.currentTime > c.end + 1.5) { state.locked = null; return false; }
    const generation = state.generation;
    try {
      if (prefs.loop) { await go(c); return true; }
      if (prefs.autoPause && state.pausedKey !== c.key) {
        state.controlling = true; state.pausedKey = c.key; state.current = c;
        await control("pause"); render(true); return true;
      }
      state.locked = null;
    } catch (e) { notice(e.message, true); state.locked = null; }
    finally { if (generation === state.generation) state.controlling = false; }
    return false;
  }
  function bindVideo(v) {
    if (state.video === v) return;
    releaseTracks(); state.video = v; state.observer.reset(); state.locked = null;
    lastTrackSignature = ""; lastChineseSignature = "";
  }
  function tick() {
    if (!state.ref || !state.loaded) return;
    const v = findVideo();
    if (!v || v.readyState < 1) return;
    bindVideo(v);
    if (advert()) { state.locked = null; state.current = null; state.observer.reset(); render(); notice("广告播放期间暂停学习记录"); return; }
    if (!v.paused) state.playing = true;
    if (state.locked && (prefs.loop || prefs.autoPause)) void boundary(v);
    const precise = trackCaptions(v);
    let done = null;
    if (!precise && !state.imported) {
      done = state.observer.sample(renderedCaption(), v.currentTime, !v.paused, v.seeking);
      if (done) {
        state.store.put(done);
        if (!state.locked && (prefs.loop || prefs.autoPause)) { state.locked = done; void boundary(v); }
      }
    }
    const held = state.locked && (state.controlling || prefs.loop || (prefs.autoPause && v.paused));
    const current = held ? state.locked : state.store.at(v.currentTime) || state.observer.active;
    if (current?.key !== state.current?.key || current?.text !== state.current?.text) $(".explanation").hidden = true;
    state.current = current;
    if (!state.locked && current?.end && (prefs.loop || prefs.autoPause)) state.locked = current;
    render();
    if (state.ref.provider === "netflix" && performance.now() - state.lastSubtitleRequest > 15000
        && ![...state.chinese.values()].some((t) => t.store.map.size)) void readOfficial();
    updateSession();
    if (title() !== state.lastTitle) { state.lastTitle = title(); $(".title").textContent = state.lastTitle; }
  }

  root.addEventListener("click", (e) => {
    const action = e.target.closest?.("[data-act]")?.dataset.act;
    if (action === "collapse") {
      prefs.collapsed = !prefs.collapsed; panel.classList.toggle("collapsed", prefs.collapsed);
      const b = $('[data-act="collapse"]'); b.title = prefs.collapsed ? "展开" : "收起"; b.setAttribute("aria-label", b.title);
      void chrome.storage.local.set({ podechoStreamingOptions: prefs });
    } else if (action === "prev" || action === "next") void go(state.store.neighbor(state.video?.currentTime || 0, action === "prev" ? -1 : 1, state.current?.key));
    else if (action === "replay") void go(state.current);
    else if (action === "cancel") { $("form").hidden = true; formContext = null; }
    else if (action === "save") {
      const selection = root.getSelection?.() || window.getSelection();
      const selected = selection && $(".sentence").contains(selection.anchorNode) ? selection.toString().trim() : "";
      openForm(selected || state.current?.text || "");
    } else if (action === "settings") void chrome.runtime.sendMessage({ type: "options" });
    else if (action === "history") void chrome.runtime.sendMessage({ type: "open", path: "/history" });
    else if (action === "refresh") void refresh();
    else if (action === "subtitles") {
      if (state.ref?.provider === "netflix") void readOfficial("prepare");
      else { lastTrackSignature = ""; lastChineseSignature = ""; tick(); }
    }
    else if (action === "resume") {
      const s = state.ref && sessions.get(state.ref.key);
      if (s) void go({ start: s.resume, text: "", key: "resume" });
    }
  });
  root.addEventListener("change", async (e) => {
    const opt = e.target.dataset.opt;
    if (Object.hasOwn(prefs, opt)) {
      prefs[opt] = e.target.checked; state.locked = null; state.pausedKey = null;
      void chrome.storage.local.set({ podechoStreamingOptions: prefs }); render(true);
    } else if (e.target === $('[data-part="chinese"]')) {
      if (!["zh-Hans", "zh-Hant", "off"].includes(e.target.value)) return;
      prefs.chinese = e.target.value; lastChineseSignature = "";
      void chrome.storage.local.set({ podechoStreamingOptions: prefs }); render(true); void readOfficial();
    } else if (e.target === $('[data-part="rate"]')) {
      try { await control("rate", { rate: Number(e.target.value) }); } catch (err) { notice(err.message, true); }
    } else if (e.target === $('[data-part="file"]')) {
      const file = e.target.files[0], generation = state.generation;
      e.target.value = ""; if (!file) return;
      try {
        if (file.size > 5 * 1024 * 1024) throw new Error("字幕文件超过 5 MB，请先拆分。");
        const cues = C.parseSubtitles(await file.text());
        if (generation !== state.generation) return;
        if (new Set([...state.store.map.keys(), ...cues.map((c) => c.key)]).size > 10000) throw new Error("这一集的字幕已超过一万条，请换一个文件。");
        for (const c of cues) state.store.put(c);
        state.imported = true; state.observer.reset(); render(true); notice(`已导入 ${cues.length} 条字幕`);
        const s = sessions.get(state.ref.key); if (s) { s.title = title(); await persist(s); }
      } catch (err) { if (generation === state.generation) notice(err.message, true); }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!state.ref || !state.video || prefs.collapsed || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
    const el = e.composedPath()[0];
    if (el?.matches?.("input, textarea, select") || el?.isContentEditable || el?.closest?.('[role="textbox"], [role="dialog"]')) return;
    const key = e.key.toLowerCase();
    if (key === "a" || key === "d") void go(state.store.neighbor(state.video.currentTime, key === "a" ? -1 : 1, state.current?.key));
    else if (key === "s") void go(state.current);
    else if (key === "r") { prefs.loop = !prefs.loop; state.locked = null; state.pausedKey = null; render(true); void chrome.storage.local.set({ podechoStreamingOptions: prefs }); }
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  document.addEventListener("seeking", (e) => {
    if (e.target !== state.video) return;
    state.observer.reset();
    const expected = state.expectedSeek;
    state.expectedSeek = null;
    if (!expected || performance.now() > expected.until || Math.abs(e.target.currentTime - expected.time) > 0.75) {
      state.locked = null; state.pausedKey = null;
    }
  }, true);
  document.addEventListener("play", (e) => {
    if (state.ref && state.loaded && !advert() && e.target === findVideo()) {
      bindVideo(e.target); state.playing = true;
    }
  }, true);
  document.addEventListener("pause", () => { const s = updateSession(); if (s) void persist(s); }, true);
  document.addEventListener("visibilitychange", () => { const s = updateSession(); if (s) void persist(s); });
  window.addEventListener("pagehide", () => { const s = updateSession(); if (s) void persist(s, false); });
  document.addEventListener("fullscreenchange", () => {
    const full = document.fullscreenElement;
    // A <video> cannot render child HTML. A player wrapper can keep the panel visible in fullscreen.
    (full && full.tagName !== "VIDEO" ? full : document.documentElement).append(host);
  });
  chrome.storage.local.get({ podechoStreamingOptions: prefs }).then(({ podechoStreamingOptions }) => {
    for (const key of Object.keys(prefs)) if (typeof prefs[key] === "boolean" && typeof podechoStreamingOptions[key] === "boolean") prefs[key] = podechoStreamingOptions[key];
    if (["zh-Hans", "zh-Hant", "off"].includes(podechoStreamingOptions.chinese)) prefs.chinese = podechoStreamingOptions.chinese;
    panel.classList.toggle("collapsed", prefs.collapsed);
    void navigate();
    setInterval(() => { void navigate(); tick(); }, 150);
    setInterval(() => { const s = updateSession(); if (s) void persist(s); }, 10000);
  });
})();

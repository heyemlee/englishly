// PodEcho on YouTube watch pages: a small panel to go through the video sentence by sentence,
// using the sentences of the same video in your local PodEcho app.
(() => {
  if (window.__podechoLoaded) return;
  window.__podechoLoaded = true;

  const PAD_START = 0.1; // caption times are estimates; pad so words aren't clipped
  const PAD_END = 0.25;
  const OPTIONS = { loop: false, autoPause: false, showText: true, collapsed: false };

  const api = (path, method, body) => chrome.runtime.sendMessage({ type: "api", path, method, body });
  const storage = chrome.storage?.local;

  const state = { videoId: null, episode: null, cur: -1, pausedAt: -1, ...OPTIONS };

  // --- UI (in a shadow root so YouTube's CSS and ours don't mix) -----------------------------------------------
  const host = document.createElement("div");
  host.id = "podecho-root";
  const root = host.attachShadow({ mode: "open" });
  // Black and white liquid glass like the web app; colours follow YouTube's light or dark theme (syncTheme below).
  const icon = (d, fill) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    prev: icon('<path d="M18 6.2v11.6a.8.8 0 0 1-1.25.66l-8.4-5.8a.8.8 0 0 1 0-1.32l8.4-5.8A.8.8 0 0 1 18 6.2z"/><rect x="5" y="5.5" width="2.2" height="13" rx="1.1"/>', true),
    next: icon('<path d="M6 6.2v11.6a.8.8 0 0 0 1.25.66l8.4-5.8a.8.8 0 0 0 0-1.32l-8.4-5.8A.8.8 0 0 0 6 6.2z"/><rect x="16.8" y="5.5" width="2.2" height="13" rx="1.1"/>', true),
    replay: icon('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>'),
    chevron: icon('<path d="m6 9 6 6 6-6"/>'),
    wave: icon('<path d="M4 10.5v3M8 7.5v9M12 4.5v15M16 7.5v9M20 10.5v3" stroke-width="2.4"/>'),
  };
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        --text: #0d0d0d; --muted: #666667; --subtle: #9b9b9c; --fill: rgba(0, 0, 0, 0.05); --fill-strong: rgba(0, 0, 0, 0.09);
        --glass: rgba(255, 255, 255, 0.72); --sheen: rgba(255, 255, 255, 0.55); --border: rgba(0, 0, 0, 0.08);
        --rim: rgba(255, 255, 255, 0.9); --primary: #0d0d0d; --on-primary: #fff; --bad: #d1242f;
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; box-sizing: border-box;
        width: 360px; max-width: calc(100vw - 32px); color: var(--text);
        background: linear-gradient(150deg, var(--sheen), transparent 45%), var(--glass);
        border: 1px solid var(--border); border-radius: 24px;
        box-shadow: inset 0 1px 0 var(--rim), 0 2px 6px rgba(0, 0, 0, 0.06), 0 20px 48px -12px rgba(0, 0, 0, 0.3);
        -webkit-backdrop-filter: blur(28px) saturate(180%); backdrop-filter: blur(28px) saturate(180%);
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .panel.dark {
        --text: #ededed; --muted: #9f9fa0; --subtle: #6c6c6e; --fill: rgba(255, 255, 255, 0.08); --fill-strong: rgba(255, 255, 255, 0.14);
        --glass: rgba(30, 30, 32, 0.72); --sheen: rgba(255, 255, 255, 0.07); --border: rgba(255, 255, 255, 0.1);
        --rim: rgba(255, 255, 255, 0.08); --primary: #ededed; --on-primary: #0d0d0d; --bad: #ff6b61;
      }
      .panel.collapsed { width: auto; border-radius: 999px; }
      .head { display: flex; align-items: center; gap: 8px; padding: 9px 9px 9px 12px; }
      .logo { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: 8px;
        background: var(--primary); color: var(--on-primary); }
      .logo svg { width: 15px; height: 15px; }
      .brand { font-weight: 600; letter-spacing: -0.01em; }
      .pos { flex: 1; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .body { display: grid; gap: 12px; padding: 2px 14px 14px; }
      .collapsed .body { display: none; }
      .collapsed [data-act="collapse"] svg { transform: rotate(180deg); }
      .sentence { font-size: 17px; line-height: 1.5; min-height: 1.5em; letter-spacing: -0.005em; }
      .masked { color: var(--subtle); }
      .msg { color: var(--muted); font-size: 13px; } .error { color: var(--bad); }
      .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box;
        height: 32px; padding: 0 14px; border: 0; border-radius: 999px; cursor: pointer;
        font: inherit; font-size: 13px; font-weight: 500; color: var(--text); background: var(--fill);
        transition: background-color 0.15s, opacity 0.15s, transform 0.1s; }
      button:hover { background: var(--fill-strong); }
      button:active { transform: scale(0.97); }
      button.primary { background: var(--primary); color: var(--on-primary); }
      button.primary:hover { opacity: 0.85; }
      button svg { width: 16px; height: 16px; flex: none; }
      .controls { display: flex; gap: 6px; }
      .controls button { height: 40px; }
      .controls .round { width: 40px; padding: 0; }
      .controls .primary { flex: 1; font-size: 14px; }
      .ghost { width: 30px; height: 30px; padding: 0; background: transparent; color: var(--muted); }
      .ghost:hover { background: var(--fill); color: var(--text); }
      .chips label { position: relative; display: inline-flex; align-items: center; height: 28px; padding: 0 12px;
        border-radius: 999px; background: var(--fill); color: var(--muted); font-size: 12px; font-weight: 500;
        cursor: pointer; user-select: none; transition: background-color 0.15s, color 0.15s; }
      .chips label:hover { color: var(--text); }
      .chips label:has(input:checked) { background: var(--primary); color: var(--on-primary); }
      .chips label:has(input:focus-visible) { outline: 2px solid var(--text); outline-offset: 2px; }
      .chips input { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
      .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      a { color: var(--text); font-size: 12px; font-weight: 500; cursor: pointer; text-decoration: none; }
      a:hover { text-decoration: underline; text-underline-offset: 3px; }
      .keys { display: flex; gap: 3px; color: var(--subtle); }
      kbd { font: 10px/1 ui-monospace, Menlo, monospace; border: 1px solid currentColor; border-radius: 4px; padding: 2px 4px; }
      button:focus-visible, a:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
      [hidden] { display: none !important; }
    </style>
    <div class="panel" hidden>
      <div class="head">
        <span class="logo">${ICON.wave}</span>
        <span class="brand">PodEcho</span><span class="pos"></span>
        <button class="ghost" data-act="collapse" title="收起" aria-label="收起">${ICON.chevron}</button>
      </div>
      <div class="body">
        <div class="msg"></div>
        <div class="row" data-part="setup" hidden></div>
        <div data-part="practice" hidden>
          <div class="sentence"></div>
          <div class="controls" style="margin-top:12px">
            <button class="round" data-act="prev" title="上一句（A）" aria-label="上一句">${ICON.prev}</button>
            <button class="primary" data-act="replay" title="重播（S）">${ICON.replay}重播</button>
            <button class="round" data-act="next" title="下一句（D）" aria-label="下一句">${ICON.next}</button>
          </div>
          <div class="row chips" style="margin-top:12px">
            <label title="单句循环（R）"><input type="checkbox" data-opt="loop">单句循环</label>
            <label><input type="checkbox" data-opt="autoPause">每句后暂停</label>
            <label><input type="checkbox" data-opt="showText">字幕</label>
          </div>
          <div class="foot" style="margin-top:12px">
            <a data-act="practice" title="听写、跟读、收藏表达">在 PodEcho 里练这句 →</a>
            <span class="keys" title="A 上一句 · S 重播 · D 下一句 · R 单句循环"><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>R</kbd></span>
          </div>
        </div>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (sel) => root.querySelector(sel);
  const panel = $(".panel");
  const msg = $(".msg");
  const setup = $('[data-part="setup"]');
  const practice = $('[data-part="practice"]');

  // YouTube marks its dark theme with a `dark` attribute on <html>.
  const syncTheme = () => panel.classList.toggle("dark", document.documentElement.hasAttribute("dark"));
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["dark"] });
  syncTheme();

  function show(message, { error = false, buttons = [] } = {}) {
    msg.textContent = message;
    msg.className = error ? "msg error" : "msg";
    msg.hidden = !message;
    setup.replaceChildren(
      ...buttons.map(([label, onClick, primary]) => {
        const b = document.createElement("button");
        b.textContent = label;
        if (primary) b.className = "primary";
        b.addEventListener("click", onClick);
        return b;
      }),
    );
    setup.hidden = buttons.length === 0;
    practice.hidden = true;
  }

  function renderSentence() {
    const ep = state.episode;
    if (!ep) return;
    practice.hidden = false;
    msg.hidden = true;
    setup.hidden = true;
    const s = ep.sentences[state.cur];
    $(".pos").textContent = s ? `第 ${state.cur + 1} / ${ep.sentences.length} 句` : `${ep.sentences.length} 句`;
    const el = $(".sentence");
    if (!s) {
      el.textContent = "播放视频，或者点「下一句」开始。";
      el.className = "sentence masked";
    } else {
      el.textContent = state.showText ? s.text : s.text.replace(/[A-Za-z0-9’']/g, "•");
      el.className = state.showText ? "sentence" : "sentence masked";
    }
    root.querySelectorAll("[data-opt]").forEach((box) => {
      box.checked = Boolean(state[box.dataset.opt]);
    });
  }

  function setCollapsed(collapsed) {
    state.collapsed = collapsed;
    panel.classList.toggle("collapsed", collapsed);
    const toggle = $('[data-act="collapse"]');
    toggle.title = collapsed ? "展开" : "收起";
    toggle.setAttribute("aria-label", toggle.title);
    saveOptions();
  }

  function saveOptions() {
    const opts = Object.fromEntries(Object.keys(OPTIONS).map((k) => [k, state[k]]));
    storage?.set({ podechoOptions: opts });
  }

  // --- Loading the episode for the current video -----------------------------------------------------------------
  function currentVideoId() {
    return location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null;
  }

  async function load() {
    const id = currentVideoId();
    if (id === state.videoId) return;
    Object.assign(state, { videoId: id, episode: null, cur: -1, pausedAt: -1 });
    panel.hidden = !id;
    if (!id) return;
    $(".pos").textContent = "";
    show("正在找这个视频…");
    const res = await api(`/api/episodes/by-video/${id}`);
    if (state.videoId !== id) return; // navigated away meanwhile
    if (res?.ok) {
      state.episode = res.data;
      renderSentence();
    } else if (res?.status === 404) {
      show("这个视频还没导入 PodEcho。", { buttons: [["导入，逐句练", importVideo, true]] });
    } else if (res?.status === 401) {
      show("PodEcho 需要访问密码：在插件设置里填上。", {
        error: true,
        buttons: [["插件设置", () => chrome.runtime.sendMessage({ type: "options" })]],
      });
    } else {
      offline(res);
    }
  }

  function offline(res) {
    show(`连不上 PodEcho（${res?.appUrl ?? "本机"}）：确认 PodEcho 在运行（bin/podecho start），或者在插件设置里改地址。`, {
      error: true,
      buttons: [
        ["重试", () => { state.videoId = null; load(); }],
        ["插件设置", () => chrome.runtime.sendMessage({ type: "options" })],
      ],
    });
  }

  async function importVideo() {
    const id = state.videoId;
    show("导入中…");
    const res = await api("/api/episodes", "POST", { url: id });
    if (state.videoId !== id) return;
    if (res?.ok) {
      state.episode = res.data;
      renderSentence();
    } else if (res?.status === 0) {
      offline(res);
    } else {
      show(res?.data?.detail ?? `导入失败（${res?.status}）`, { error: true, buttons: [["重试", importVideo, true]] });
    }
  }

  // --- Following and controlling the video -----------------------------------------------------------------------
  const video = () => document.querySelector("video.html5-main-video") ?? document.querySelector("video");

  function sentenceAt(t) {
    const list = state.episode?.sentences ?? [];
    let idx = -1;
    for (let i = 0; i < list.length && list[i].start - PAD_START <= t; i++) idx = i;
    return idx;
  }

  function go(i) {
    const list = state.episode?.sentences;
    const v = video();
    if (!list?.length || !v) return;
    state.cur = Math.min(Math.max(i, 0), list.length - 1);
    state.pausedAt = -1;
    v.currentTime = Math.max(0, list[state.cur].start - PAD_START);
    v.play();
    renderSentence();
  }

  function check() {
    const v = video();
    const list = state.episode?.sentences;
    if (v && list?.length) {
      const t = v.currentTime;
      const cur = list[state.cur];
      let handled = false;
      if (cur && !v.paused && t >= cur.end + PAD_END && t < cur.end + 2) {
        if (state.loop) {
          v.currentTime = Math.max(0, cur.start - PAD_START);
          handled = true;
        } else if (state.autoPause && state.pausedAt !== state.cur) {
          v.pause();
          state.pausedAt = state.cur;
          handled = true;
        }
      }
      // While looping, and with auto-pause until playback goes on past the pause, stay on the sentence (the next
      // one's padded start comes before this one's padded end) unless the learner seeks somewhere else.
      const holding = state.loop || (state.autoPause && (state.pausedAt !== state.cur || v.paused));
      const keep = holding && cur && t >= cur.start - 1 && t <= cur.end + 2;
      if (!handled && !keep) {
        const idx = sentenceAt(t);
        if (idx !== state.cur) {
          state.cur = idx;
          renderSentence();
        }
      }
    }
  }

  function tick() {
    check();
    requestAnimationFrame(tick);
  }

  // --- Events -----------------------------------------------------------------------------------------------------
  root.addEventListener("click", (e) => {
    const act = e.target.closest?.("[data-act]")?.dataset.act;
    if (act === "collapse") setCollapsed(!state.collapsed);
    else if (act === "prev") go(state.cur - 1);
    else if (act === "next") go(state.cur + 1);
    else if (act === "replay") go(Math.max(state.cur, 0));
    else if (act === "practice" && state.episode) {
      chrome.runtime.sendMessage({ type: "open", path: `/episode?id=${state.episode.id}&s=${Math.max(state.cur, 0)}` });
    }
  });
  root.addEventListener("change", (e) => {
    const opt = e.target.dataset?.opt;
    if (!opt) return;
    state[opt] = e.target.checked;
    state.pausedAt = -1;
    saveOptions();
    renderSentence();
  });

  // A / S / D / R, but never while typing (search box, comments). YouTube itself doesn't use these keys.
  document.addEventListener(
    "keydown",
    (e) => {
      if (!state.episode || state.collapsed || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.composedPath()[0];
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === "a") go(state.cur - 1);
      else if (key === "s") go(Math.max(state.cur, 0));
      else if (key === "d") go(state.cur + 1);
      else if (key === "r") {
        state.loop = !state.loop;
        saveOptions();
        renderSentence();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  // requestAnimationFrame stops while the tab is in the background; timeupdate (about 4 times a second, and it
  // doesn't bubble, hence capture) keeps loop and auto-pause working while you listen from another tab.
  document.addEventListener("timeupdate", check, true);

  // YouTube is a single-page app: follow navigations between videos.
  document.addEventListener("yt-navigate-finish", load);
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      load();
    }
  }, 1000);

  (storage ? storage.get({ podechoOptions: OPTIONS }) : Promise.resolve({ podechoOptions: OPTIONS })).then(({ podechoOptions }) => {
    Object.assign(state, OPTIONS, podechoOptions);
    setCollapsed(state.collapsed);
    load();
    requestAnimationFrame(tick);
  });
})();

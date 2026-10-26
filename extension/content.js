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
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 340px; max-width: calc(100vw - 32px);
        background: rgba(28, 25, 23, 0.94); color: #f5f5f4; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
        font: 14px/1.45 -apple-system, "PingFang SC", "Segoe UI", sans-serif; }
      .head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: default; }
      .brand { font-weight: 600; } .pos { color: #a8a29e; font-size: 12px; flex: 1; }
      .body { padding: 0 12px 12px; display: grid; gap: 8px; }
      .collapsed .body { display: none; }
      .sentence { font-size: 17px; min-height: 1.45em; }
      .masked { color: #78716c; letter-spacing: 1px; }
      .msg { color: #d6d3d1; font-size: 13px; } .error { color: #fca5a5; }
      .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      button { font: inherit; font-size: 13px; color: #f5f5f4; background: #292524; border: 1px solid #44403c;
        border-radius: 8px; padding: 4px 10px; cursor: pointer; }
      button:hover { border-color: #2dd4bf; } button.primary { background: #0f766e; border-color: #0f766e; }
      button.icon { padding: 0 8px; background: transparent; border: none; color: #a8a29e; font-size: 16px; }
      label { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; color: #d6d3d1; cursor: pointer; }
      kbd { font: 11px ui-monospace, Menlo, monospace; opacity: .6; border: 1px solid currentColor; border-radius: 4px; padding: 0 3px; }
      a { color: #5eead4; font-size: 12px; cursor: pointer; text-decoration: underline; }
      [hidden] { display: none !important; }
    </style>
    <div class="panel" hidden>
      <div class="head">
        <span class="brand">PodEcho</span><span class="pos"></span>
        <button class="icon" data-act="collapse" title="收起/展开">–</button>
      </div>
      <div class="body">
        <div class="msg"></div>
        <div class="row" data-part="setup" hidden></div>
        <div data-part="practice" hidden>
          <div class="sentence"></div>
          <div class="row" style="margin-top:8px">
            <button data-act="prev">◀ 上一句 <kbd>A</kbd></button>
            <button data-act="replay" class="primary">⟲ 重播 <kbd>S</kbd></button>
            <button data-act="next">下一句 ▶ <kbd>D</kbd></button>
          </div>
          <div class="row" style="margin-top:8px">
            <label><input type="checkbox" data-opt="loop">单句循环 <kbd>R</kbd></label>
            <label><input type="checkbox" data-opt="autoPause">每句后暂停</label>
            <label><input type="checkbox" data-opt="showText">字幕</label>
          </div>
          <div style="margin-top:8px"><a data-act="practice">在 PodEcho 里练这句（听写、跟读、收藏表达）</a></div>
        </div>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (sel) => root.querySelector(sel);
  const panel = $(".panel");
  const msg = $(".msg");
  const setup = $('[data-part="setup"]');
  const practice = $('[data-part="practice"]');

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
    $('[data-act="collapse"]').textContent = collapsed ? "+" : "–";
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
      show("这个视频还没导入 PodEcho。", { buttons: [["导入，开始逐句练", importVideo, true]] });
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
    show("导入中…一般几秒钟。");
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

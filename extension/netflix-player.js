// MAIN world only: a narrow playback bridge. No extension API, account data, network interception or DRM access.
(() => {
  if (window.__podechoNetflixBridge) return;
  window.__podechoNetflixBridge = true;
  window.addEventListener("message", async (event) => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.channel !== "podecho:netflix:command"
        || typeof m.id !== "string" || m.id.length > 100 || !/^(play|pause|seek|rate)$/.test(m.action)
        || m.mediaId !== location.pathname.match(/^\/watch\/(\d+)/)?.[1]) return;
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI()?.videoPlayer;
      const sessions = api?.getAllPlayerSessionIds?.() || [];
      const session = sessions.find((id) => String(id).includes("watch")) || sessions[0];
      const player = session ? api.getVideoPlayerBySessionId(session) : null;
      const video = [...document.querySelectorAll("video")].find((v) => v.offsetWidth > 0);
      if (m.action === "seek") {
        if (!Number.isFinite(m.time) || m.time < 0 || m.time > 172800) throw new Error("跳转位置不对。");
        if (player?.seek) await player.seek(Math.round(m.time * 1000));
        else if (video) video.currentTime = m.time;
        else throw new Error("还没有找到播放器。");
      } else if (m.action === "play" || m.action === "pause") {
        const target = player?.[m.action] ? player : video;
        if (!target) throw new Error("还没有找到播放器。");
        await target[m.action]();
      } else {
        if (![0.75, 1, 1.25, 1.5].includes(m.rate) || !video) throw new Error("暂时无法调速。");
        video.playbackRate = m.rate;
      }
      window.postMessage({ channel: "podecho:netflix:reply", id: m.id, ok: true }, location.origin);
    } catch {
      window.postMessage({ channel: "podecho:netflix:reply", id: m.id, ok: false, error: "官网播放器暂时无法执行，请先手动播放一次。" }, location.origin);
    }
  });
})();

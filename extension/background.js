// Talks to the local PodEcho app for the content scripts. Requests from here aren't bound by the streaming site's CORS,
// so the app needs no extra setup.

const DEFAULT_APP_URL = "http://localhost:8811";

// The access password of a PodEcho on a cloud server; kept on this computer only (storage.local, not synced).
async function password() {
  const { password } = await chrome.storage.local.get({ password: "" });
  return password;
}

async function appUrl() {
  const { appUrl } = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL });
  return appUrl.replace(/\/+$/, "");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "api") {
    if (typeof msg.path !== "string" || !msg.path.startsWith("/api/") || /[\\\r\n#]/.test(msg.path)) {
      sendResponse({ ok: false, status: 400, error: "接口地址不对。" });
      return false;
    }
    (async () => {
      const base = await appUrl();
      const pw = await password();
      try {
        const res = await fetch(base + msg.path, {
          method: msg.method ?? "GET",
          headers: { "Content-Type": "application/json", ...(pw ? { Authorization: `Bearer ${pw}` } : {}) },
          body: msg.body === undefined ? undefined : JSON.stringify(msg.body),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        const data = await res.json().catch(() => null);
        sendResponse({ ok: res.ok, status: res.status, data, appUrl: base });
      } catch (e) {
        sendResponse({ ok: false, status: 0, error: String(e), appUrl: base });
      }
    })();
    return true; // answer asynchronously
  }
  if (msg?.type === "open") {
    if (typeof msg.path !== "string" || !/^\/(?!\/)/.test(msg.path) || /[\\\r\n]/.test(msg.path)) return false;
    appUrl().then((base) => chrome.tabs.create({ url: base + msg.path }));
  }
  if (msg?.type === "options") {
    chrome.runtime.openOptionsPage();
  }
  return false;
});

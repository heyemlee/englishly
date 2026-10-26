const DEFAULT_APP_URL = "http://localhost:8811";
const input = document.getElementById("url");
const passwordInput = document.getElementById("password");
const status = document.getElementById("status");

function setStatus(text, ok) {
  status.textContent = text;
  status.className = ok === undefined ? "" : ok ? "ok" : "bad";
}

chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL }).then(({ appUrl }) => {
  input.value = appUrl;
});
chrome.storage.local.get({ password: "" }).then(({ password }) => {
  passwordInput.value = password;
});

document.getElementById("save").addEventListener("click", async () => {
  let url;
  try {
    url = new URL(input.value.trim() || DEFAULT_APP_URL);
  } catch {
    return setStatus("地址格式不对，比如 http://localhost:8811", false);
  }
  const origin = url.origin;
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    return setStatus("请填写 http 或 https 的 PodEcho 地址。", false);
  }
  // localhost is allowed up front; any other address (a LAN IP, a Tailscale name) needs the user's OK once.
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) return setStatus("没有获得访问这个地址的权限。", false);
  }
  await chrome.storage.sync.set({ appUrl: origin });
  await chrome.storage.local.set({ password: passwordInput.value });
  input.value = origin;
  setStatus("测试中…");
  const res = await chrome.runtime.sendMessage({ type: "api", path: "/api/health" });
  const check = res?.ok ? await chrome.runtime.sendMessage({ type: "api", path: "/api/episodes" }) : res;
  if (check?.status === 401) setStatus("已保存，但访问密码不对（或者没填）。", false);
  else if (check?.ok) setStatus(`已保存，连接正常（${origin}）。刷新 YouTube、Netflix 或 Hulu 页面就能用。`, true);
  else setStatus(`已保存，但连不上 ${origin}：确认 PodEcho 在运行（bin/podecho start）。`, false);
});

document.getElementById("open").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "open", path: "/" });
});

// Optional real MV3 smoke test: NODE_PATH=<directory containing playwright> node --test extension/tests/browser.test.cjs
// Uses a temporary PodEcho database and simulated platform pages, never the user's account or media.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
let playwright;
try { playwright = require("playwright"); } catch { /* optional browser dependency */ }

function wav() {
  const frames = 16000 * 15, b = Buffer.alloc(44 + frames * 2);
  b.write("RIFF", 0); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(frames * 2, 40);
  return b.toString("base64");
}

test("MV3: native tracks, Netflix bridge, Hulu captions, import, loop, pause, notebook, offline retry and navigation", { skip: !playwright, timeout: 90000 }, async () => {
  const project = resolve(__dirname, "../..");
  const directory = await mkdtemp(join(tmpdir(), "podecho-extension-"));
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const server = spawn(join(project, "backend/.venv/bin/python"), ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port), "--no-access-log"], {
    cwd: join(project, "backend"), env: { ...process.env, DB_PATH: join(directory, "test.db"), PODECHO_PASSWORD: "", PODECHO_MODE: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = ""; server.stderr.on("data", (b) => { logs += b; });
  const base = `http://127.0.0.1:${port}`;
  let context;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(base + "/api/streaming")).ok) break; } catch { /* starting */ }
      if (i > 60) throw new Error(`Test backend did not start: ${logs}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    context = await playwright.chromium.launchPersistentContext(join(directory, "chrome"), {
      channel: "chromium", headless: true,
      ...(process.env.PODECHO_CHROMIUM ? { executablePath: process.env.PODECHO_CHROMIUM } : {}),
      args: [`--disable-extensions-except=${join(project, "extension")}`, `--load-extension=${join(project, "extension")}`, "--autoplay-policy=no-user-gesture-required"],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate((appUrl) => chrome.storage.sync.set({ appUrl }), base);
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on("console", (m) => { if (m.type() === "error") console.log("PAGE:", m.text()); });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route(/https:\/\/(www\.)?(netflix|hulu)\.com\//, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Test show | Netflix</title>
      <style>body{margin:0;background:#141414;color:white}video{width:640px;height:360px}</style>
      <video controls src="data:audio/wav;base64,${wav()}"></video><div class="player-timedtext"><span class="player-timedtext-text-container"></span></div>
      <div class="captions-display"></div><script>
      const v = document.querySelector('video'); window.seeks = 0;
      window.netflix = {appContext:{state:{playerApp:{getAPI:()=>({videoPlayer:{getAllPlayerSessionIds:()=>['watch-session'],getVideoPlayerBySessionId:()=>({seek:ms=>{window.seeks++;v.currentTime=ms/1000},play:()=>v.play(),pause:()=>v.pause()})}})}}}};
      window.addTrack = () => {const t=v.addTextTrack('subtitles','English','en');t.mode='hidden';
        t.addCue(new VTTCue(1,3,'I ended up staying.'));t.addCue(new VTTCue(4,6,'Come across a friend.'));return t;};
      </script>` }));
    const panel = page.locator("#podecho-streaming-root");
    const netflix = "/api/streaming/netflix/80000000";
    await page.goto("https://www.netflix.com/watch/80000000");
    await panel.locator('[data-act="resume"]').waitFor({ state: "attached" });
    await page.evaluate(() => { window.addTrack(); document.querySelector("video").currentTime = 1.5; });
    await panel.locator(".sentence").filter({ hasText: "I ended up staying." }).waitFor();
    await page.evaluate(() => {
      const v = document.querySelector("video");
      const zh = v.addTextTrack("subtitles", "简体中文", "zh-CN"); zh.mode = "disabled";
      zh.addCue(new VTTCue(.9, 3.2, "官方简体字幕。"));
      const hant = v.addTextTrack("subtitles", "繁體中文", "zh-TW"); hant.mode = "disabled";
      hant.addCue(new VTTCue(.9, 3.2, "官方繁體字幕。"));
    });
    await panel.locator(".translation").filter({ hasText: "官方简体字幕。" }).waitFor();
    await panel.locator('[data-part="chinese"]').selectOption("zh-Hant");
    await panel.locator(".translation").filter({ hasText: "官方繁體字幕。" }).waitFor();
    await panel.locator('[data-part="chinese"]').selectOption("zh-Hans");
    await panel.locator('[data-act="next"]').click();
    await page.waitForFunction(() => document.querySelector("video").currentTime >= 4 && window.seeks > 0);
    await panel.locator('[data-act="replay"]').click();
    await page.waitForFunction(() => document.querySelector("video").currentTime < 5);

    await panel.locator('[data-opt="showText"]').uncheck();
    assert.equal(await panel.locator(".sentence").textContent(), "字幕已隐藏");
    assert.equal(await panel.locator('[data-act="save"]').isDisabled(), true);
    await panel.locator('[data-opt="showText"]').check();

    // Exercise the actual local API through the extension worker.
    await page.evaluate(() => document.querySelector("video").pause());
    await page.waitForTimeout(250);
    let data = await (await fetch(base + netflix)).json();
    assert.equal(data.sentences.length, 2);
    const cue = data.sentences.find((c) => c.text.startsWith("I ended"));
    await fetch(base + netflix + "/study", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      sentences: [{ sentence_id: cue.id, text: cue.text, translation_zh: "我最后还是留下了。", annotations: [
        { kind: "phrase", start: 2, end: 10, text: "ended up", meaning_zh: "最后还是", usage_zh: "描述最终结果。" },
      ] }],
    }) });
    await panel.locator('[data-act="prev"]').click();
    await page.evaluate(() => document.querySelector("video").pause());
    await panel.locator('[data-act="refresh"]').click();
    await panel.locator(".annotation").waitFor();
    await panel.locator(".annotation").click();
    await panel.locator(".explanation button").click();
    await panel.locator('form button[type="submit"]').click();
    await panel.locator("[data-part=status]").filter({ hasText: "已保存到单词本" }).waitFor();
    const chunks = await (await fetch(base + "/api/chunks")).json();
    assert.equal(chunks[0].pattern, "ended up"); assert.equal(chunks[0].in_review, true);
    assert.ok(chunks[0].notes.includes("netflix.com/watch/80000000"));

    await panel.locator('[data-opt="autoPause"]').check();
    await panel.locator('[data-act="replay"]').click();
    await page.waitForFunction(() => document.querySelector("video").paused && document.querySelector("video").currentTime >= 2.95);
    await panel.locator('[data-opt="autoPause"]').uncheck();
    await panel.locator('[data-opt="loop"]').check();
    await panel.locator('[data-act="replay"]').click();
    await page.waitForTimeout(2400);
    assert.ok(await page.evaluate(() => document.querySelector("video").currentTime < 3));
    await page.evaluate(() => { document.querySelector("video").currentTime = 4.3; });
    await panel.locator(".sentence").filter({ hasText: "Come across a friend." }).waitFor();
    assert.ok(await page.evaluate(() => document.querySelector("video").currentTime >= 4.3));
    await panel.locator('[data-opt="loop"]').uncheck();
    await page.evaluate(() => document.querySelector("video").pause());

    // Switching episodes resets captions and boundaries, including when the same DOM video survives SPA navigation.
    await page.evaluate(() => {
      history.pushState(null, "", "/watch/80000001"); document.querySelector("video").currentTime = 0;
    });
    await panel.locator(".hint").filter({ hasText: "0 条字幕" }).waitFor();
    await panel.locator('[data-part="file"]').setInputFiles({ name: "sample.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nImported first.\n\n2\n00:00:04,000 --> 00:00:06,000\nImported second.") });
    await panel.locator(".hint").filter({ hasText: "2 条字幕" }).waitFor();
    await page.evaluate(() => { document.querySelector("video").currentTime = 1.5; });
    await panel.locator(".sentence").filter({ hasText: "Imported first." }).waitFor();
    assert.equal((await (await fetch(base + "/api/streaming/netflix/80000001")).json()).sentences.length, 2);

    // Hulu's rendered captions are observed live; no future captions or exact boundaries are invented.
    await page.goto("https://www.hulu.com/watch/12345678-1234-1234-1234-123456789abc");
    await panel.locator(".site").filter({ hasText: "Hulu" }).waitFor();
    await page.evaluate(() => { const v = document.querySelector("video"); v.currentTime = 1; document.querySelector(".captions-display").textContent = "A live English caption."; return v.play(); });
    await panel.locator(".sentence").filter({ hasText: "A live English caption." }).waitFor();
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.querySelector(".captions-display").textContent = "The following caption."; });
    await panel.locator(".hint").filter({ hasText: "1 条字幕" }).waitFor();
    await page.evaluate(() => document.querySelector("video").pause());
    const hulu = "/api/streaming/hulu/12345678-1234-1234-1234-123456789abc";
    for (let i = 0; i < 30; i++) {
      data = await (await fetch(base + hulu)).json();
      if (data.sentences?.length) break;
      await page.waitForTimeout(100);
    }
    assert.equal(data.sentences[0].timing, "observed");
    assert.equal(data.sentences[0].text, "A live English caption.");
    await page.evaluate(() => { const ad = document.createElement("div"); ad.dataset.testid = "ad-countdown"; ad.textContent = "Ad"; document.body.append(ad); });
    await panel.locator("[data-part=status]").filter({ hasText: "广告播放期间暂停学习记录" }).waitFor();
    await page.evaluate(() => document.querySelector('[data-testid="ad-countdown"]').remove());

    // Backend outage keeps a local cache, then the same dirty captions are retried successfully.
    await worker.evaluate(() => chrome.storage.sync.set({ appUrl: "http://127.0.0.1:1" }));
    await panel.locator('[data-part="file"]').setInputFiles({ name: "offline.vtt", mimeType: "text/vtt", buffer: Buffer.from("WEBVTT\n\n00:05.000 --> 00:07.000\nOffline cue.") });
    await panel.locator("[data-part=status]").filter({ hasText: "尚未同步" }).waitFor();
    const local = await worker.evaluate(() => chrome.storage.local.get("podechoStreaming:hulu:12345678-1234-1234-1234-123456789abc"));
    assert.ok(Object.values(local)[0].sentences.some((c) => c.text === "Offline cue."));
    await worker.evaluate((appUrl) => chrome.storage.sync.set({ appUrl }), base);
    await page.evaluate(() => { const v = document.querySelector("video"); return v.play().then(() => v.pause()); });
    for (let i = 0; i < 30; i++) {
      data = await (await fetch(base + hulu)).json();
      if (data.sentences.some((c) => c.text === "Offline cue.")) break;
      await page.waitForTimeout(100);
    }
    assert.ok(data.sentences.some((c) => c.text === "Offline cue."));
    await page.reload();
    await panel.locator(".hint").filter({ hasText: "2 条字幕" }).waitFor();
    await panel.locator('[data-act="resume"]').waitFor({ state: "visible" });
    await page.screenshot({ path: process.env.PODECHO_SCREENSHOT || join(directory, "panel.png") });
    await page.goto(base + "/history");
    await page.getByRole("heading", { name: "Netflix / Hulu" }).waitFor();
    const links = page.locator('a[href*="podecho_t="]');
    assert.equal(await links.count(), 3);
    assert.ok((await links.first().getAttribute("href")).startsWith("https://www.hulu.com/watch/"));
    assert.deepEqual(errors, []);
    console.log("MV3 smoke passed: real extension + temporary FastAPI/SQLite; screenshots are temporary.");
  } finally {
    if (context) await context.close();
    server.kill("SIGTERM");
    await new Promise((r) => { if (server.exitCode !== null) r(); else { server.once("exit", r); setTimeout(r, 3000).unref(); } });
    await rm(directory, { recursive: true, force: true });
  }
});

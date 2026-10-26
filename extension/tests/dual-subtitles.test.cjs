const { test } = require("node:test");
const assert = require("node:assert/strict");
const { launch, wav, available } = require("./browser-harness.cjs");
const TTML = {
  en: '<tt:tt xmlns:tt="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="1000"><tt:body><tt:div><tt:p begin="1000t" end="3000t">I <tt:span>ended up</tt:span> staying.</tt:p><tt:p begin="5000t" end="7000t">Another scene.</tt:p></tt:div></tt:body></tt:tt>',
  hans: '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:00.900" end="00:00:01.800">我最后</p><p begin="00:00:01.800" end="00:00:03.200">还是留下了。</p></div></body></tt>',
  hant: 'WEBVTT\n\n00:00.900 --> 00:03.200\n我最後還是留下了。',
};

function html(movieId, { warm = false, noChinese = false, failChinese = false } = {}) {
  const track = (id, language, profile, field) => ({ id, language, languageDescription: id,
    ...(!warm ? { ttDownloadables: { [profile]: field === "urls"
      ? { urls: [{ url: `https://subs.nflxvideo.net/${id}.ttml` }] } : { downloadUrls: { cdn: `https://subs.nflxvideo.net/${id}.ttml` } } } } : {}) });
  const tracks = [track("en", "en-US", "imsc1.1", "urls")];
  if (!noChinese) tracks.push(track("hans", "zh-Hans", "dfxp-ls-sdh", "downloadUrls"), track("hant", "zh-Hant", "webvtt-lssdh-ios8", "urls"));
  return `<!doctype html><title>Dual subtitle fixture | Netflix</title><style>body{margin:0;background:#141414;color:white}video{width:640px;height:360px}</style>
    <video controls src="data:audio/wav;base64,${wav()}"></video><div class="player-timedtext"><div class="player-timedtext-text-container">I ended up staying.</div></div>
    <script>
    const manifest = JSON.parse(${JSON.stringify(JSON.stringify({ result: { movieId: +movieId, textTracks: tracks } }))});
    const v=document.querySelector('video'); const tracks=manifest.result.textTracks;
    window.fixture={active:tracks[0],paused:0,played:0,selected:[],failChinese:${failChinese}};
    const player={getTimedTextTrackList:()=>tracks,getTimedTextTrack:()=>window.fixture.active,
      setTimedTextTrack:async(t)=>{window.fixture.active=t;window.fixture.selected.push(t.id);await fetch('https://subs.nflxvideo.net/'+t.id+'.ttml');},
      seek:ms=>{v.currentTime=ms/1000},play:()=>{window.fixture.played++;return v.play()},pause:()=>{window.fixture.paused++;v.pause()}};
    window.netflix={appContext:{state:{playerApp:{getAPI:()=>({videoPlayer:{getAllPlayerSessionIds:()=>['watch'],getVideoPlayerBySessionId:()=>player}})}}}};
    </script>`;
}

test("official Netflix manifests: TTML/VTT, unequal bilingual timing, script selection, hidden answers, saved notes and persistence", { skip: !available, timeout: 60000 }, async () => {
  const f = await launch();
  try {
    let noChinese = false;
    const requested = [];
    await f.context.route(/https:\/\/www\.netflix\.com\//, (route) => route.fulfill({ contentType: "text/html", body: html(new URL(route.request().url()).pathname.split("/").pop(), { noChinese }) }));
    await f.context.route(/https:\/\/subs\.nflxvideo\.net\//, (route) => {
      assert.equal(route.request().headers().cookie, undefined);
      const id = new URL(route.request().url()).pathname.slice(1).split(".")[0]; requested.push(id);
      return route.fulfill({ contentType: id === "hant" ? "text/vtt" : "application/ttml+xml", headers: { "Access-Control-Allow-Origin": "https://www.netflix.com" }, body: TTML[id] });
    });
    const p = f.page, panel = p.locator("#podecho-streaming-root");
    await p.goto("https://www.netflix.com/watch/80000002");
    await panel.locator(".hint").filter({ hasText: "2 条字幕" }).waitFor();
    await p.evaluate(() => { document.querySelector("video").currentTime = 1.5; });
    await panel.locator(".translation").filter({ hasText: "我最后\n还是留下了。" }).waitFor();
    assert.equal(await panel.locator(".translation").getAttribute("title"), "官方字幕 · hans");
    assert.equal(await p.evaluate(() => window.fixture.active.id), "en");
    assert.equal(await p.evaluate(() => document.querySelector("video").paused), true);
    assert.ok(requested.includes("en") && requested.includes("hans"));

    // Full TTML parsing is exercised in Chrome, with the same shared module as the shipped MAIN bridge.
    const parsed = await p.evaluate(() => window.PodechoStreaming.parseTimedText('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25"><body><div begin="2s"><p begin="00:00:01:12" dur="50f">A<span> &amp; B</span><br/>C</p></div></body></tt>'));
    assert.equal(parsed[0].start, 3.48); assert.equal(parsed[0].end, 5.48); assert.equal(parsed[0].text, "A & B\nC");
    assert.equal(await p.evaluate(() => { try { window.PodechoStreaming.parseTimedText('<tt><body><p begin="1s" end="3s">broken</body></tt>'); return false; } catch { return true; } }), true);
    assert.deepEqual(await p.evaluate(() => {
      let syntaxError = false; try { JSON.parse("{"); } catch (e) { syntaxError = e instanceof SyntaxError; }
      return { value: JSON.parse('{"n":1}', (k, v) => k === "n" ? v + 1 : v).n, syntaxError };
    }), { value: 2, syntaxError: true });

    await panel.locator('[data-part="chinese"]').selectOption("zh-Hant");
    await panel.locator(".translation").filter({ hasText: "我最後還是留下了。" }).waitFor();
    await panel.locator('[data-opt="showText"]').uncheck();
    assert.equal(await panel.locator(".translation").textContent(), "");
    assert.equal(await panel.locator(".translation").getAttribute("title"), "");
    await panel.locator('[data-opt="showText"]').check();
    await panel.locator('[data-part="chinese"]').selectOption("off");
    assert.equal(await panel.locator(".translation").isVisible(), false);
    await panel.locator('[data-part="chinese"]').selectOption("zh-Hans");
    await p.evaluate(async () => { const v = document.querySelector("video"); await v.play(); v.pause(); });
    await panel.locator('[data-part="status"]').filter({ hasText: "学习记录已保存" }).waitFor();
    const url = f.base + "/api/streaming/netflix/80000002";
    const data = await (await fetch(url)).json();
    assert.equal(data.sentences.length, 2); assert.equal(data.official_subtitles.length, 3);
    assert.equal(data.sentences[0].translation_zh, null); // official translation never replaces supplied study text
    await fetch(url + "/study", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      sentences: [{ sentence_id: data.sentences[0].id, text: data.sentences[0].text, translation_zh: "保留的语境翻译。" }],
    }) });
    await panel.locator('[data-act="refresh"]').click();
    await panel.locator(".translation").filter({ hasText: "保留的语境翻译。" }).waitFor();
    assert.equal(await panel.locator(".translation").getAttribute("title"), "已保存中文");
    await p.evaluate(() => { document.querySelector("video").currentTime = 5.5; });
    await panel.locator(".sentence").filter({ hasText: "Another scene." }).waitFor();
    assert.equal(await panel.locator(".translation").isVisible(), false); // no translation carried across a gap

    // The next title offers no Chinese track; neither another episode nor a previous asynchronous response may fill it.
    noChinese = true;
    await p.goto("https://www.netflix.com/watch/80000003");
    await panel.locator(".hint").filter({ hasText: "尚未读到中文轨" }).waitFor();
    await p.evaluate(() => { document.querySelector("video").currentTime = 1.5; });
    await panel.locator(".sentence").filter({ hasText: "I ended up staying." }).waitFor();
    assert.equal(await panel.locator(".translation").isVisible(), false);
    // Standard HTML tracks also provide bilingual captions on Hulu without the Netflix-specific adapter.
    await f.context.route(/https:\/\/www\.hulu\.com\//, (route) => route.fulfill({ contentType: "text/html", body: html("80000006") }));
    await p.goto("https://www.hulu.com/watch/12345678-1234-1234-1234-123456789abc");
    await panel.locator(".site").filter({ hasText: "Hulu" }).waitFor();
    await p.evaluate(() => {
      const v = document.querySelector("video"); const en = v.addTextTrack("subtitles", "English", "en"); en.mode = "showing";
      en.addCue(new VTTCue(1, 3, "Hulu English."));
      const zh = v.addTextTrack("subtitles", "简体中文", "zh-CN"); zh.mode = "disabled";
      zh.addCue(new VTTCue(.9, 3.2, "Hulu 官方中文。")); v.currentTime = 1.5;
    });
    await panel.locator(".translation").filter({ hasText: "Hulu 官方中文。" }).waitFor();
    assert.equal(await p.evaluate(() => document.querySelector("video").textTracks[0].mode), "showing");
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("Netflix on-demand track warming restores native settings after success or a failed Chinese response", { skip: !available, timeout: 60000 }, async () => {
  const f = await launch();
  try {
    let failure = false;
    await f.context.route(/https:\/\/www\.netflix\.com\//, (route) => route.fulfill({ contentType: "text/html", body: html(new URL(route.request().url()).pathname.split("/").pop(), { warm: true }) }));
    await f.context.route(/https:\/\/subs\.nflxvideo\.net\//, (route) => {
      const id = new URL(route.request().url()).pathname.slice(1).split(".")[0];
      return route.fulfill({ status: failure && id === "hans" ? 403 : 200, contentType: "application/ttml+xml",
        headers: { "Access-Control-Allow-Origin": "https://www.netflix.com" }, body: TTML[id] });
    });
    const p = f.page, panel = p.locator("#podecho-streaming-root");
    await p.goto("https://www.netflix.com/watch/80000004");
    await panel.locator(".hint").filter({ hasText: "中文轨尚未载入" }).waitFor();
    await p.evaluate(() => { const v = document.querySelector("video"); v.currentTime = 1.1; return v.play(); });
    await panel.locator('[data-act="subtitles"]').click();
    await panel.locator('[data-part="status"]').filter({ hasText: "已读取官方中文字幕" }).waitFor();
    assert.equal(await p.evaluate(() => window.fixture.active.id), "en");
    assert.ok(await p.evaluate(() => window.fixture.paused > 0 && window.fixture.played > 0 && !document.querySelector("video").paused));
    await p.evaluate(() => document.querySelector("video").pause());
    await panel.locator(".translation").filter({ hasText: "还是留下了。" }).waitFor();
    if (process.env.PODECHO_SCREENSHOT) await p.screenshot({ path: process.env.PODECHO_SCREENSHOT });
    failure = true;
    await p.goto("https://www.netflix.com/watch/80000005");
    await panel.locator(".hint").filter({ hasText: "中文轨尚未载入" }).waitFor();
    await panel.locator('[data-act="subtitles"]').click();
    await panel.locator('[data-part="status"]').filter({ hasText: "尚未读到中文" }).waitFor();
    assert.equal(await p.evaluate(() => window.fixture.active.id), "en");
    assert.equal(await p.evaluate(() => document.querySelector("video").paused), true);
    assert.equal(await panel.locator(".translation").isVisible(), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

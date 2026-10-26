const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reference, plain, parseSubtitles, subtitleLanguage, subtitleTime, alignedChinese, cueKey, CueStore, ObservedCaptions } = require("../streaming-core.js");

test("only canonical watch URLs create a session; tracking params never identify another episode", () => {
  assert.deepEqual(reference("https://www.netflix.com/watch/80000000?trackId=1"), {
    provider: "netflix", mediaId: "80000000", key: "netflix:80000000", url: "https://www.netflix.com/watch/80000000",
  });
  assert.equal(reference("https://www.hulu.com/watch/12345678-1234-1234-1234-123456789ABC")?.provider, "hulu");
  for (const url of ["https://www.netflix.com/browse", "https://netflix.com/title/80000000", "https://netflix.com.evil.test/watch/80000000",
    "http://www.netflix.com/watch/80000000", "https://www.hulu.com/watch/not-an-id"]) assert.equal(reference(url), null);
});

test("SRT and VTT handle BOM, CRLF, settings, cue IDs, line breaks and text markup", () => {
  const cues = parseSubtitles('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n<i>Come across</i>\r\na friend &amp; smile.\r\n\r\n2\r\n00:00:05,000 --> 00:00:07,000\r\nHello!');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1.25); assert.equal(cues[0].text, "Come across\na friend & smile.");
  const vtt = parseSubtitles("WEBVTT\n\nNOTE ignore this\n\nSTYLE\n::cue { color: red; }\n\ncue-1\n00:01.250 --> 00:03.500 align:start\n<v Speaker>Hello &#x1f600;</v>");
  assert.equal(vtt[0].text, "Hello 😀"); assert.equal(vtt[0].end, 3.5);
  assert.equal(plain('<b>&lt;script&gt;</b>'), "<script>"); // callers render as text, never HTML
});

test("invalid and huge subtitles do not become playable cues", () => {
  for (const text of ["no subtitles", "1\n00:00:03,000 --> 00:00:01,000\nOops", "1\n00:61:00,000 --> 00:62:00,000\nOops"])
    assert.throws(() => parseSubtitles(text));
  assert.throws(() => parseSubtitles(`1\n00:00:01,000 --> 00:00:03,000\n${"a".repeat(5001)}`));
});

test("stable cue keys, ordered navigation, exact timing preference and notes survive retries", () => {
  const first = { start: 5, end: 7, text: "I ended up staying.", timing: "exact" };
  const store = new CueStore(); const a = store.put(first);
  store.put({ ...first, translation_zh: "我最后留下了。", annotations: [{ text: "ended up" }] }, false);
  store.put(first);
  assert.equal(store.map.size, 1); assert.equal(store.map.get(a.key).translation_zh, "我最后留下了。");
  assert.equal(cueKey({ ...first, end: 7.5 }), a.key);
  const b = store.put({ start: 1, end: 2, text: "Earlier.", timing: "exact" });
  store.put({ start: 5.1, end: 7, text: first.text, timing: "observed" });
  assert.equal(store.at(5.5).timing, "exact");
  assert.equal(store.neighbor(5.5, -1, a.key).key, b.key);
  assert.equal(store.neighbor(5.5, 1, a.key), null);
  assert.equal(store.at(3), null);
});

test("DOM captions only close on an observed change, and never across seeks, pauses or suspension", () => {
  const o = new ObservedCaptions();
  assert.equal(o.sample("One", 10, true), null);
  assert.equal(o.sample("One", 10.5, true), null);
  const done = o.sample("Two", 11, true);
  assert.equal(done.text, "One"); assert.equal(done.start, 10); assert.equal(done.end, 11);
  assert.equal(done.timing, "observed");
  assert.equal(o.sample("After seek", 100, true, true), null);
  assert.equal(o.sample("Paused language change", 100, false), null);
  assert.equal(o.sample("After suspension", 120, true), null);
  o.reset(); assert.equal(o.sample("Again", 0, true), null);
});

test("official track language tags distinguish English, simplified Chinese and traditional Chinese", () => {
  for (const s of ["en", "en-US", "eng"]) assert.equal(subtitleLanguage(s), "en");
  for (const s of ["zh-Hans", "zh_CN", "zh-Hans-CN"]) assert.equal(subtitleLanguage(s), "zh-Hans");
  for (const s of ["zh-Hant", "zh-TW", "zh-HK"]) assert.equal(subtitleLanguage(s), "zh-Hant");
  assert.equal(subtitleLanguage("zh", "Chinese (Simplified)"), "zh-Hans");
  assert.equal(subtitleLanguage("zh", "繁體中文"), "zh-Hant");
  assert.equal(subtitleLanguage("zh"), "zh");
  assert.equal(subtitleLanguage("ja", "日本語"), null);
});

test("TTML time expressions support real frame/tick rates instead of assuming milliseconds", () => {
  assert.equal(subtitleTime("00:01:02.125"), 62.125);
  assert.equal(subtitleTime("1250ms"), 1.25);
  assert.equal(subtitleTime("200t", { tickRate: 100 }), 2);
  assert.equal(subtitleTime("50f", { frameRate: 25 }), 2);
  assert.equal(subtitleTime("00:00:01:12", { frameRate: 24 }), 1.5);
  assert.ok(Number.isNaN(subtitleTime("00:65:00")));
  assert.ok(Number.isNaN(subtitleTime("1garbage")));
});

test("dual subtitles align by overlap, handle unequal segmentation, and never invent translations in gaps", () => {
  const zh = [{ start: .9, end: 1.8, text: "开头" }, { start: 1.8, end: 4.5, text: "后半句。" },
    { start: 10, end: 12, text: "下一段。" }];
  assert.equal(alignedChinese({ start: 1, end: 3 }, zh), "开头\n后半句。");
  assert.equal(alignedChinese({ start: 3, end: 4 }, zh), "后半句。");
  assert.equal(alignedChinese({ start: 6, end: 8 }, zh), "");
  assert.equal(alignedChinese({ start: 9, text: "live" }, zh, 10.5), "下一段。");
  assert.equal(alignedChinese({ start: 9, text: "live" }, zh, 9.5), "");
  assert.equal(alignedChinese({ start: 4.49, end: 6 }, zh), ""); // a 10 ms boundary sliver isn't a translation
});

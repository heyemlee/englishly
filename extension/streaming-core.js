// Shared, dependency-free subtitle logic. CommonJS export lets node --test exercise the same code as Chrome.
((scope) => {
  const MAX_CUES = 10000;
  const MAX_TIME = 172800;
  function reference(href) {
    const u = new URL(href);
    const netflix = /^(www\.)?netflix\.com$/.test(u.hostname);
    const hulu = /^(www\.)?hulu\.com$/.test(u.hostname);
    const match = netflix ? u.pathname.match(/^\/watch\/(\d{1,20})\/?$/)
      : hulu ? u.pathname.match(/^\/watch\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\/?$/i) : null;
    if (!match || u.protocol !== "https:") return null;
    const provider = netflix ? "netflix" : "hulu";
    const mediaId = match[1].toLowerCase();
    return { provider, mediaId, key: `${provider}:${mediaId}`, url: `https://www.${provider}.com/watch/${mediaId}` };
  }

  function plain(s) {
    return String(s).replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, "")
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[m])
      .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
        const value = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
        return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
      }).replace(/[ \t]+/g, " ").trim();
  }

  function timestamp(s) {
    if (!/^(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}$/.test(s)) return NaN;
    const p = s.replace(",", ".").split(":").map(Number);
    if (p[p.length - 1] >= 60 || p[p.length - 2] >= 60) return NaN;
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  }

  function cueKey(cue) {
    // Include the full text, not an index: importing more cues never renumbers saved notes.
    let hash = 2166136261;
    for (const ch of cue.text) { hash ^= ch.codePointAt(0); hash = Math.imul(hash, 16777619); }
    return `${cue.timing === "observed" ? "o" : "e"}:${Math.round(cue.start * 1000)}:${(hash >>> 0).toString(16)}`;
  }

  function parseSubtitles(text) {
    const blocks = String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/);
    const result = [];
    for (const block of blocks) {
      if (/^(?:WEBVTT|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block.trim())) continue;
      const lines = block.trim().split("\n");
      const i = lines.findIndex((line) => line.includes("-->"));
      if (i < 0) continue;
      const match = lines[i].match(/^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
      if (!match) continue;
      const start = timestamp(match[1]), end = timestamp(match[2]);
      const content = plain(lines.slice(i + 1).join("\n"));
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > MAX_TIME || !content) continue;
      if (content.length > 5000) throw new Error("有一条字幕太长，请检查文件。");
      const cue = { start, end, text: content, timing: "exact" };
      result.push({ ...cue, key: cueKey(cue) });
      if (result.length > MAX_CUES) throw new Error("字幕太多，最多导入一万条。");
    }
    if (!result.length) throw new Error("没有找到有效字幕，请选择 SRT 或 VTT 文件。");
    return [...new Map(result.map((c) => [c.key, c])).values()].sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function subtitleLanguage(language = "", label = "") {
    const code = language.toLowerCase().replaceAll("_", "-");
    if (/^(en|eng)(-|$)/.test(code) || (!code && /\benglish\b/i.test(label))) return "en";
    if (/^(zh|zho|chi|cmn|yue)(-|$)/.test(code) || /chinese|中文|简体|簡體|繁体|繁體/i.test(label)) {
      if (/hant|-(tw|hk|mo)(-|$)/.test(code) || /traditional|繁体|繁體/i.test(label)) return "zh-Hant";
      if (/hans|-cn(-|$)/.test(code) || /simplified|简体|簡體/i.test(label)) return "zh-Hans";
      return "zh";
    }
    return null;
  }

  function subtitleTime(value, { frameRate = 30, tickRate = 1 } = {}) {
    if (typeof value !== "string") return NaN;
    const s = value.trim();
    let m = s.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
    if (m && +m[2] < 60 && +m[3] < 60) return +m[1] * 3600 + +m[2] * 60 + +m[3] + Number(`0.${m[4] || 0}`);
    m = s.match(/^(\d+):(\d{2}):(\d{2}):(\d+)(?:\.(\d+))?$/);
    if (m && +m[2] < 60 && +m[3] < 60 && +m[4] < frameRate) return +m[1] * 3600 + +m[2] * 60 + +m[3] + (+m[4] + Number(`0.${m[5] || 0}`)) / frameRate;
    m = s.match(/^(\d+(?:\.\d+)?)(ms|h|m|s|f|t)$/);
    return m ? +m[1] * ({ ms: .001, h: 3600, m: 60, s: 1, f: 1 / frameRate, t: 1 / tickRate })[m[2]] : NaN;
  }

  function parseTimedText(text, options = {}) {
    if (typeof text !== "string" || text.length > 5 * 1024 * 1024) throw new Error("字幕文件超过大小限制。");
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<(?:\w+:)?tt[\s>]/.test(text.replace(/^\uFEFF/, ""))) return parseSubtitles(text);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("不支持包含外部实体的字幕。");
    const Parser = options.DOMParser || globalThis.DOMParser;
    if (!Parser) throw new Error("当前环境不支持 XML 字幕。");
    const xml = new Parser().parseFromString(text, "application/xml");
    if (xml.getElementsByTagNameNS("*", "parsererror").length) throw new Error("字幕 XML 格式不对。");
    const tt = xml.documentElement;
    const attr = (el, name) => [...el.attributes].find((a) => a.localName === name)?.value;
    let frameRate = Number(attr(tt, "frameRate")) || 30;
    const multiplier = (attr(tt, "frameRateMultiplier") || "1 1").trim().split(/\s+/).map(Number);
    if (multiplier.length === 2 && multiplier[0] > 0 && multiplier[1] > 0) frameRate *= multiplier[0] / multiplier[1];
    const tickRate = Number(attr(tt, "tickRate")) || options.tickRate || 1;
    const timing = { frameRate, tickRate };
    const content = (node) => node.nodeType === 3 ? node.nodeValue : node.localName === "br" ? "\n"
      : [...node.childNodes].map(content).join("");
    const result = []; let visited = 0;
    function walk(node, base, inheritedEnd) {
      if (++visited > 100000) throw new Error("字幕结构过大。");
      const beginValue = attr(node, "begin"), endValue = attr(node, "end"), durValue = attr(node, "dur");
      const begin = beginValue === undefined ? 0 : subtitleTime(beginValue, timing);
      const start = base + begin;
      const end = Math.min(inheritedEnd, endValue !== undefined ? base + subtitleTime(endValue, timing)
        : durValue !== undefined ? start + subtitleTime(durValue, timing) : inheritedEnd);
      if (!Number.isFinite(start) || Number.isNaN(end)) return end;
      if (node.localName === "p") {
        const text = content(node).replace(/[ \t\r]+/g, " ").trim();
        if (text && text.length <= 5000 && end > start && Number.isFinite(end) && end <= MAX_TIME) {
          result.push({ start, end, text, timing: "exact" });
          if (result.length > MAX_CUES) throw new Error("字幕超过一万条。");
        }
      } else {
        let sequence = start;
        for (const child of node.children) {
          const childEnd = walk(child, attr(node, "timeContainer") === "seq" ? sequence : start, end);
          if (Number.isFinite(childEnd)) sequence = childEnd;
        }
      }
      return end;
    }
    walk(tt, 0, Infinity);
    if (!result.length) throw new Error("没有找到有效的文字字幕。");
    return result.sort((a, b) => a.start - b.start || a.end - b.end).map((c) => ({ ...c, key: cueKey(c) }));
  }

  function alignedChinese(cue, subtitles, time = cue?.start ?? 0) {
    if (!cue) return "";
    const hasRange = cue.end > cue.start;
    const start = hasRange ? cue.start : time, end = hasRange ? cue.end : time + .001;
    const matches = [];
    for (const c of subtitles) {
      if (c.start >= end) break;
      const overlap = Math.min(end, c.end) - Math.max(start, c.start);
      if (overlap > 0 && (!hasRange || overlap >= Math.min(.15, (end - start) * .2, (c.end - c.start) * .2))) matches.push(c.text);
    }
    return [...new Set(matches)].join("\n");
  }

  class CueStore {
    constructor(cues = []) {
      this.map = new Map(); this.sorted = []; this.dirty = new Set();
      cues.forEach((c) => this.put(c, false));
    }
    put(c, dirty = true) {
      if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || c.end > MAX_TIME || !c.text?.trim()) return null;
      const key = c.key || cueKey(c);
      const old = this.map.get(key);
      if (!old && this.map.size >= MAX_CUES) return null;
      if (old && old.start === c.start && old.end === c.end && old.text === c.text && !c.annotations && !c.translation_zh) return old;
      const value = { ...old, ...c, key };
      this.map.set(key, value);
      this.sorted = null;
      if (dirty) this.dirty.add(key);
      return value;
    }
    list() { return this.sorted ||= [...this.map.values()].sort((a, b) => a.start - b.start || a.end - b.end); }
    at(time) {
      // Cue count is bounded. Prefer exact timestamps over approximate, observed DOM captions.
      let found = null;
      for (const c of this.list()) {
        if (c.start > time + 0.03) break;
        if (time < c.end && (!found || c.timing === "exact" || found.timing !== "exact")) found = c;
      }
      return found;
    }
    neighbor(time, direction, key) {
      const exact = this.list().filter((c) => c.timing === "exact");
      let at = 0;
      const list = this.list().filter((c) => {
        while (at < exact.length && exact[at].start < c.start - 1) at++;
        return c.timing === "exact" || !exact[at] || Math.abs(exact[at].start - c.start) >= 1;
      });
      const index = list.findIndex((c) => c.key === key);
      if (index >= 0) return list[index + direction] || null;
      return direction > 0 ? list.find((c) => c.start > time + 0.05) || null
        : [...list].reverse().find((c) => c.start < time - 0.1) || null;
    }
  }

  class ObservedCaptions {
    constructor() { this.reset(); }
    reset() { this.active = null; this.lastTime = null; }
    sample(text, time, playing, seeking = false) {
      let done = null;
      // DOM only tells us when text changes. Never infer a cue's end through a pause, seek, advert or tab suspension.
      const discontinuity = seeking || this.lastTime === null || time < this.lastTime - 0.05 || time - this.lastTime > 1.5;
      if (discontinuity) this.active = null;
      if (this.active && text !== this.active.text) {
        if (playing && time - this.active.start > 0.1 && time - this.active.start < 30) {
          done = { ...this.active, end: time, timing: "observed" };
          done.key = cueKey(done);
        }
        this.active = null;
      }
      if (text && !this.active) this.active = { text, start: time };
      this.lastTime = time;
      return done;
    }
  }

  const api = { reference, plain, parseSubtitles, parseTimedText, subtitleTime, subtitleLanguage, alignedChinese, cueKey, CueStore, ObservedCaptions };
  scope.PodechoStreaming = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);

"use client";

import { useRef, useState } from "react";

import { api, type ChunkState, type ManualChunkIn } from "@/lib/api";
import { Btn, ErrorBar, Toggle } from "@/components/ui";

// Only the English is needed: the meaning and example can be left for Codex to fill in.
const EMPTY: ManualChunkIn = { pattern: "", meaning_zh: "", context_en: "", add_to_review: true };
const INPUT = "field h-11 w-full rounded-full px-4 sm:h-10";
const AREA = "field w-full rounded-2xl px-4 py-2.5";
const LABEL = "block space-y-1.5 text-[13px] text-muted";

export default function AddNotebookEntry({ onSaved, onCancel }: { onSaved: (entry: ChunkState) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<ManualChunkIn>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const field = (key: keyof ManualChunkIn, value: string | boolean) => setDraft((old) => ({ ...old, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current || !draft.pattern.trim()) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.addManualChunk(draft));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={(e) => void save(e)} className="glass space-y-5 rounded-3xl p-5 sm:p-6" aria-label="添加词条">
    <h2 className="text-lg font-semibold tracking-tight">添加词条</h2>
    <ErrorBar message={error} onClose={() => setError(null)} />
    <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          <span>英文</span>
          <input autoFocus required lang="en" autoCapitalize="off" spellCheck={false} value={draft.pattern} maxLength={200}
            onChange={(e) => field("pattern", e.target.value)} placeholder="come across" className={INPUT} />
        </label>
        <label className={LABEL} title="可以先空着，之后再补">
          <span>中文释义</span>
          <input value={draft.meaning_zh} maxLength={200} onChange={(e) => field("meaning_zh", e.target.value)}
            placeholder="偶然遇见" className={INPUT} />
        </label>
      </div>
      <label className={LABEL} title="可以先空着，之后再补">
        <span>英文例句</span>
        <textarea rows={2} lang="en" value={draft.context_en} maxLength={1000} onChange={(e) => field("context_en", e.target.value)}
          placeholder="I came across this word in a book." className={AREA} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle checked={draft.add_to_review} onChange={(v) => field("add_to_review", v)}
          title="生成复习卡，按记忆规律安排复习；没有中文释义时，补上释义后自动加入">
          加入复习
        </Toggle>
        <div className="flex gap-2">
          <Btn disabled={busy} onClick={onCancel}>取消</Btn>
          <button type="submit" disabled={busy || !draft.pattern.trim()}
            className="h-10 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity disabled:opacity-35">
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </fieldset>
  </form>;
}

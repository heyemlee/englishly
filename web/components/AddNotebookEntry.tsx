"use client";

import { useRef, useState } from "react";

import { api, type ManualChunkIn } from "@/lib/api";
import { IconChevronDown } from "@/components/icons";
import { Btn, ErrorBar, Toggle } from "@/components/ui";

const EMPTY: ManualChunkIn = {
  pattern: "", meaning_zh: "", context_en: "", context_zh: "", source_label: "", notes: "", add_to_review: true,
};
const INPUT = "field h-11 w-full rounded-full px-4 sm:h-10";
const AREA = "field w-full rounded-2xl px-4 py-2.5";
const LABEL = "block space-y-1.5 text-[13px] text-muted";

export default function AddNotebookEntry({ onSaved, onCancel }: { onSaved: (review: boolean) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<ManualChunkIn>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const field = (key: keyof ManualChunkIn, value: string | boolean) => setDraft((old) => ({ ...old, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current || !draft.pattern.trim() || !draft.meaning_zh.trim()) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.addManualChunk(draft);
      onSaved(draft.add_to_review);
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
        <label className={LABEL}>
          <span>中文释义</span>
          <input required value={draft.meaning_zh} maxLength={200} onChange={(e) => field("meaning_zh", e.target.value)}
            placeholder="偶然遇见" className={INPUT} />
        </label>
      </div>
      <details className="group rounded-2xl border border-border">
        <summary className="flex cursor-pointer items-center justify-between rounded-2xl px-4 py-3 text-sm text-muted">
          例句、来源和笔记
          <IconChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 px-4 pb-4">
          <label className={LABEL}>
            <span>英文例句</span>
            <textarea rows={2} lang="en" value={draft.context_en} maxLength={1000} onChange={(e) => field("context_en", e.target.value)}
              placeholder="I came across this word in a book." className={AREA} />
          </label>
          <label className={LABEL}>
            <span>例句中文</span>
            <textarea rows={2} value={draft.context_zh} maxLength={1000} onChange={(e) => field("context_zh", e.target.value)} className={AREA} />
          </label>
          <label className={LABEL}>
            <span>来源</span>
            <input value={draft.source_label} maxLength={200} onChange={(e) => field("source_label", e.target.value)}
              placeholder="英语课、书名、网站" className={INPUT} />
          </label>
          <label className={LABEL}>
            <span>笔记</span>
            <textarea rows={2} value={draft.notes} maxLength={2000} onChange={(e) => field("notes", e.target.value)}
              placeholder="用法、易混点" className={AREA} />
          </label>
        </div>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle checked={draft.add_to_review} onChange={(v) => field("add_to_review", v)} title="生成复习卡，按记忆规律安排复习">
          加入复习
        </Toggle>
        <div className="flex gap-2">
          <Btn disabled={busy} onClick={onCancel}>取消</Btn>
          <button type="submit" disabled={busy || !draft.pattern.trim() || !draft.meaning_zh.trim()}
            className="h-10 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity disabled:opacity-35">
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </fieldset>
  </form>;
}

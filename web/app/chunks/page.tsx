"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";

import { api, episodeHref, type SavedChunk } from "@/lib/api";
import ChunkAudio from "@/components/ChunkAudio";
import AddNotebookEntry from "@/components/AddNotebookEntry";
import { IconCheck, IconPlay, IconPlus, IconSearch, IconTrash, IconX } from "@/components/icons";
import { Btn, Card, cx, ErrorBar, PageTitle, SpeakButton, Spinner } from "@/components/ui";

const SELECT = "field h-11 max-w-[60vw] shrink-0 truncate rounded-full pl-4 sm:h-10 sm:max-w-64";
const TAG = "rounded-full px-2 py-0.5";

export default function ChunksPage() {
  const [chunks, setChunks] = useState<SavedChunk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query); // typing stays quick; the list catches up right after
  const [source, setSource] = useState("all");
  const [editing, setEditing] = useState<number | null>(null);
  const [meaning, setMeaning] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<SavedChunk | null>(null);
  const [adding, setAdding] = useState(false);
  const [enrolling, setEnrolling] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState("all");

  useEffect(() => {
    api
      .chunks()
      .then(setChunks)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function remove(id: number) {
    if (!confirm("删除这个词条和对应的复习卡？")) return;
    try {
      await api.deleteChunk(id);
      setChunks((list) => list?.filter((c) => c.id !== id) ?? null);
      if (playing?.id === id) setPlaying(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveMeaning() {
    if (editing === null || !meaning.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateChunk(editing, meaning.trim());
      setChunks((list) => list?.map((c) => c.id === editing ? { ...c, ...updated } : c) ?? null);
      setEditing(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function added(review: boolean) {
    setAdding(false);
    setNotice(review ? "已保存并加入复习" : "已保存");
    setQuery(""); setSource("all"); setReviewFilter("all");
    void api.chunks().then(setChunks).catch((e: Error) => setError(`词条已保存，刷新列表失败：${e.message}`));
  }

  async function enroll(id: number) {
    if (enrolling !== null) return;
    setEnrolling(id); setError(null);
    try {
      await api.enrollChunk(id);
      setChunks((list) => list?.map((c) => c.id === id ? { ...c, in_review: true } : c) ?? null);
      setNotice("已加入复习");
    } catch (e) { setError((e as Error).message); }
    finally { setEnrolling(null); }
  }

  const sources = [...new Map((chunks ?? []).filter((c) => c.episode_id !== null).map((c) => [c.episode_id, c.episode_title ?? "未命名节目"])).entries()];
  const filtering = !!search.trim() || source !== "all" || reviewFilter !== "all";
  const filtered = chunks?.filter((c) => (source === "all" || (source === "manual" ? c.entry_source === "manual" : String(c.episode_id) === source))
    && (reviewFilter === "all" || c.in_review === (reviewFilter === "review"))
    && `${c.pattern} ${c.meaning_zh} ${c.sentence_text ?? ""} ${c.episode_title ?? ""} ${c.context_en} ${c.context_zh} ${c.source_label} ${c.notes}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return (
    <div className="space-y-6">
      <PageTitle
        title="单词本"
        action={!adding && (
          <Btn primary onClick={() => { setAdding(true); setNotice(null); }}>
            <IconPlus className="size-4" /> 添加
          </Btn>
        )}
      />
      <ErrorBar message={error} onClose={() => setError(null)} />
      {notice && (
        <p role="status" className="flex items-center gap-3 rounded-2xl bg-fill px-4 py-3 text-sm">
          <IconCheck className="size-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <Link href="/review" className="font-medium underline underline-offset-4">去复习</Link>
          <button onClick={() => setNotice(null)} aria-label="关闭提示" className="-m-1 rounded-full p-1 text-muted hover:bg-fill">
            <IconX className="size-4" />
          </button>
        </p>
      )}
      {adding && <AddNotebookEntry onSaved={added} onCancel={() => setAdding(false)} />}
      {!!chunks?.length && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="field flex h-11 min-w-0 items-center gap-2.5 rounded-full px-4 sm:h-10 sm:flex-1">
            <IconSearch className="size-4 shrink-0 text-subtle" />
            <input type="search" aria-label="搜索单词本" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索"
              className="min-w-0 flex-1 bg-transparent outline-none focus-visible:outline-none" />
          </label>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
            <select aria-label="按来源筛选" value={source} onChange={(e) => setSource(e.target.value)} className={SELECT}>
              <option value="all">全部来源</option><option value="manual">手动添加</option>{sources.map(([id, title]) => <option key={id} value={String(id)}>{title}</option>)}
            </select>
            <select aria-label="按复习状态筛选" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)} className={SELECT}>
              <option value="all">全部状态</option><option value="review">复习中</option><option value="record">仅记录</option>
            </select>
          </div>
        </div>
      )}
      {filtering && <p className="px-1 text-sm text-muted">{filtered?.length ?? 0} 个词条</p>}
      {playing && <ChunkAudio key={playing.id} chunk={playing} onClose={() => setPlaying(null)} />}
      {chunks === null && !error && <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> 加载中</p>}
      {chunks?.length === 0 && !adding && <Card pad="roomy" className="text-center text-muted">单词本还是空的</Card>}
      {!!chunks?.length && filtered?.length === 0 && <p className="py-10 text-center text-sm text-muted">没有匹配的词条。</p>}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filtered?.map((c) => (
          <li key={c.id} className="glass min-w-0 space-y-3 break-words rounded-3xl p-5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold leading-snug tracking-tight">
                  {c.pattern}
                  <SpeakButton text={c.pattern} />
                </h3>
                {editing === c.id ? (
                  <div className="mt-2 space-y-2">
                    <input aria-label="修改中文释义" value={meaning} onChange={(e) => setMeaning(e.target.value)} maxLength={200} autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveMeaning(); }}
                      className="field h-10 w-full rounded-full px-4" />
                    <div className="flex gap-2">
                      <Btn small primary disabled={busy || !meaning.trim()} onClick={() => void saveMeaning()}>{busy ? "保存中…" : "保存"}</Btn>
                      <Btn small disabled={busy} onClick={() => setEditing(null)}>取消</Btn>
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 text-[15px]">{c.meaning_zh}</p>
                )}
              </div>
              <button onClick={() => remove(c.id)} aria-label={`删除「${c.pattern}」`} title="删除"
                className="-mr-2 -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:bg-fill hover:text-bad">
                <IconTrash className="size-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className={cx(TAG, c.in_review ? "bg-fill text-muted" : "border border-border text-subtle")}>{c.in_review ? "复习中" : "仅记录"}</span>
              {c.entry_source === "manual" && <span className={cx(TAG, "bg-fill text-muted")}>手动</span>}
              {c.source_label && <span className={cx(TAG, "bg-fill text-muted")}>{c.source_label}</span>}
            </div>
            {c.context_en && <div className="rounded-2xl bg-fill p-3.5 text-sm leading-relaxed">
              <p className="whitespace-pre-wrap">{c.context_en}<SpeakButton text={c.context_en} /></p>
              {c.context_zh && <p className="mt-1 whitespace-pre-wrap text-muted">{c.context_zh}</p>}
            </div>}
            {!c.context_en && c.context_zh && <p className="text-sm text-muted">{c.context_zh}</p>}
            {c.notes && <p className="whitespace-pre-wrap text-sm text-muted">{c.notes}</p>}
            {c.sentence_text && c.episode_id !== null && (
              <Link href={episodeHref(c.episode_id, c.sentence_idx ?? 0)} className="line-clamp-3 block text-[13px] leading-relaxed text-muted hover:text-foreground">
                “{c.sentence_text}” <span className="text-subtle">— {c.episode_title}</span>
              </Link>
            )}
            {editing !== c.id && (
              <div className="flex flex-wrap gap-2 pt-1">
                {c.episode_id !== null && c.start_s !== null && c.end_s !== null && (
                  <Btn small onClick={() => setPlaying(c)}><IconPlay className="size-3" /> 听原句</Btn>
                )}
                {!c.in_review && <Btn small primary disabled={enrolling !== null} onClick={() => void enroll(c.id)}>{enrolling === c.id ? "加入中…" : "加入复习"}</Btn>}
                <Btn small disabled={busy} onClick={() => { setEditing(c.id); setMeaning(c.meaning_zh); }}>修改释义</Btn>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

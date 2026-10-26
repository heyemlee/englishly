"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, type CardKind, type CardRow, type QueueState, type ReviewCard } from "@/lib/api";
import { untilText } from "@/lib/time";
import { CardView, KIND_LABEL } from "@/components/ReviewCards";
import { IconChevronDown, IconTrash } from "@/components/icons";
import { Card, cx, ErrorBar, PageTitle, Spinner, Toggle } from "@/components/ui";

const KINDS: CardKind[] = ["produce", "listen", "cloze"];

export default function ReviewPage() {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .reviewQueue()
      .then(setQueue)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const rate = async (card: ReviewCard, rating: number, said: string, score: number | null) => {
    try {
      setQueue(await api.review(card.id, { rating, said, score }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleKind = async (kind: CardKind, on: boolean) => {
    if (!queue) return;
    const kinds = on ? [...queue.summary.kinds, kind] : queue.summary.kinds.filter((k) => k !== kind);
    if (!kinds.length) return; // keep at least one
    try {
      setQueue(await api.setReviewKinds(kinds));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const s = queue?.summary;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageTitle
        title="复习"
        subtitle={s && `待复习 ${s.due} · 新卡 ${s.new_available} · 今天已复习 ${s.reviewed_today}`}
      />
      {s && (
        <div role="group" aria-label="练哪几种" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {KINDS.map((k) => (
            <Toggle key={k} checked={s.kinds.includes(k)} onChange={(on) => void toggleKind(k, on)}>
              {KIND_LABEL[k]}
            </Toggle>
          ))}
        </div>
      )}
      <ErrorBar message={error} onClose={() => setError(null)} />
      {!queue && !error && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> 加载中
        </p>
      )}
      {queue?.card ? (
        <>
          <CardView key={`${queue.card.id}-${s?.reviewed_today}`} card={queue.card} onRate={rate} />
          <p className="hidden text-center text-xs leading-loose text-subtle pointer-fine:block">
            <kbd>空格</kbd> 看答案 · <kbd>1</kbd>–<kbd>4</kbd> 评分 · <kbd>P</kbd> 朗读 · <kbd>R</kbd> 说 · <kbd>H</kbd> 提示
          </p>
        </>
      ) : (
        queue && (
          <Card pad="roomy" className="text-center">
            {s!.total === 0 ? (
              <p className="text-muted">
                还没有卡片。
                <Link href="/chunks" className="font-medium text-foreground underline underline-offset-4">
                  去单词本添加
                </Link>
              </p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xl font-semibold tracking-tight">今天的复习做完了</p>
                {s!.next_due && <p className="text-sm text-muted">下一张 {untilText(s!.next_due)}到期</p>}
              </div>
            )}
          </Card>
        )
      )}
      <AllCards onChange={load} />
    </div>
  );
}

function AllCards({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<CardRow[] | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) setCards(await api.cards().catch(() => []));
  };
  const remove = async (id: number) => {
    if (!confirm("删除这张卡片和它的复习记录？")) return;
    await api.deleteCard(id);
    setCards((list) => list?.filter((c) => c.id !== id) ?? null);
    onChange();
  };

  return (
    <section className="space-y-3">
      <button onClick={toggle} aria-expanded={open} className="-my-2 inline-flex items-center gap-1 py-2 pr-3 text-sm text-muted transition-colors hover:text-foreground">
        全部卡片
        <IconChevronDown className={cx("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="glass divide-y divide-border overflow-hidden rounded-3xl">
          {cards === null && (
            <li className="p-4">
              <Spinner />
            </li>
          )}
          {cards?.length === 0 && <li className="p-4 text-sm text-muted">还没有卡片。</li>}
          {cards?.map((c) => (
            <li key={c.id} className="flex items-start gap-3 py-3 pl-4 pr-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-muted">{KIND_LABEL[c.kind]}</span>
                  <span>{c.prompt_zh}</span>
                </div>
                <div className="mt-1 text-muted">{c.answer_en}</div>
              </div>
              <span className="shrink-0 pt-1.5 text-xs text-subtle">{c.reps === 0 ? "新卡" : untilText(c.due)}</span>
              <button
                onClick={() => remove(c.id)}
                aria-label="删除这张卡片"
                title="删除"
                className="grid size-8 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:bg-fill hover:text-bad"
              >
                <IconTrash className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import { Fragment, useState } from "react";
import { type Annotation } from "@/lib/api";
import { IconCheck, IconReplay, IconX } from "@/components/icons";
import { Btn, IconBtn } from "@/components/ui";

export const ANNOTATION_LABELS = { word: "单词", phrase: "短语", expression: "地道表达" };

/** Offsets are Unicode code points, matching Python's slicing and the local study importer. */
export function HighlightText({ text, annotations, onSelect }: {
  text: string;
  annotations: Annotation[];
  onSelect?: (annotation: Annotation) => void;
}) {
  const chars = Array.from(text);
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  for (const annotation of [...annotations].sort((a, b) => a.start - b.start)) {
    const { start, end } = annotation;
    if (start < cursor || end > chars.length || end <= start || chars.slice(start, end).join("") !== annotation.text) continue;
    pieces.push(<Fragment key={`plain-${annotation.id}`}>{chars.slice(cursor, start).join("")}</Fragment>);
    pieces.push(onSelect ? (
      <button key={annotation.id} type="button" className="study-highlight" aria-label={`查看${ANNOTATION_LABELS[annotation.kind]}：${annotation.text}`}
        onClick={(event) => { event.stopPropagation(); onSelect(annotation); }}>
        {annotation.text}
      </button>
    ) : <mark key={annotation.id} className="study-highlight" data-annotation={annotation.id}>{annotation.text}</mark>);
    cursor = end;
  }
  pieces.push(<Fragment key="tail">{chars.slice(cursor).join("")}</Fragment>);
  return <>{pieces}</>;
}

export function AnnotationDetails({ annotation, saved, onSave, onPlay, onClose }: {
  annotation: Annotation;
  saved: boolean;
  onSave: (pattern: string, meaning: string) => Promise<boolean>;
  onPlay: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <section aria-label="重点讲解" className="glass space-y-4 rounded-3xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <span className="inline-block rounded-full bg-fill px-2.5 py-0.5 text-xs text-muted">{ANNOTATION_LABELS[annotation.kind]}</span>
          <h3 className="text-2xl font-semibold tracking-tight">{annotation.text}</h3>
        </div>
        <IconBtn label="关闭讲解" onClick={onClose} className="size-8">
          <IconX className="size-4" />
        </IconBtn>
      </div>
      <p className="text-[17px] font-medium leading-relaxed">{annotation.meaning_zh}</p>
      {annotation.usage_zh && <p className="text-sm leading-relaxed text-muted">{annotation.usage_zh}</p>}
      {annotation.example_en && <div className="space-y-1 rounded-2xl bg-fill p-4 text-sm leading-relaxed">
        <p>{annotation.example_en}</p>{annotation.example_zh && <p className="text-muted">{annotation.example_zh}</p>}
      </div>}
      <div className="flex flex-wrap gap-2">
        <Btn small onClick={onPlay}><IconReplay className="size-3.5" /> 听原句</Btn>
        {saved ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[13px] font-medium">
            <IconCheck className="size-3.5" /> 已加入复习
          </span>
        ) : (
          <Btn small primary disabled={busy} onClick={() => {
            setBusy(true);
            void onSave(annotation.text, annotation.meaning_zh).finally(() => setBusy(false));
          }}>{busy ? "保存中…" : "收藏并加入复习"}</Btn>
        )}
      </div>
    </section>
  );
}

"use client";

import type { ReactNode } from "react";

import type { WordDiff } from "@/lib/diff";
import { speak } from "@/lib/tts";
import { IconArrowUp, IconChevronDown, IconSpeaker, IconX } from "@/components/icons";

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

// Buttons don't take focus on click, so keyboard shortcuts keep working afterwards.
export const preventFocus = (e: React.MouseEvent) => e.preventDefault();

const PRESS = "select-none transition-[background-color,color,opacity,transform] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35";

export function Btn({
  children,
  onClick,
  primary,
  danger,
  small,
  large,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  small?: boolean;
  large?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={preventFocus}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium",
        PRESS,
        small ? "h-8 px-3.5 text-[13px]" : large ? "h-12 px-7 text-[15px]" : "h-10 px-4.5 text-sm",
        danger
          ? "bg-bad text-white hover:opacity-90"
          : primary
            ? "bg-foreground text-background hover:opacity-85"
            : "bg-fill text-foreground hover:bg-fill-strong",
      )}
    >
      {children}
    </button>
  );
}

/** A round icon-only button. */
export function IconBtn({
  children,
  label,
  onClick,
  disabled,
  primary,
  className = "size-10",
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={preventFocus}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "grid shrink-0 place-items-center rounded-full",
        PRESS,
        primary ? "bg-foreground text-background hover:opacity-85" : "bg-fill text-foreground hover:bg-fill-strong",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SpeakButton({ text, rate = 0.95 }: { text: string; rate?: number }) {
  return (
    <button
      type="button"
      onMouseDown={preventFocus}
      onClick={() => void speak(text, rate)}
      className="-my-1.5 ml-0.5 inline-grid size-9 shrink-0 place-items-center rounded-full align-middle text-muted transition-colors hover:bg-fill hover:text-foreground"
      title="朗读"
      aria-label="朗读"
    >
      <IconSpeaker className="size-4" />
    </button>
  );
}

export function Segmented<T extends number | string>({
  label,
  options,
  value,
  onChange,
  format,
  stretch,
  title,
  disabled,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
  stretch?: boolean; // full width on phones
  title?: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      title={title}
      className={cx("rounded-full bg-fill p-1", stretch ? "flex w-full sm:inline-flex sm:w-auto" : "inline-flex")}
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          disabled={disabled}
          onMouseDown={preventFocus}
          onClick={() => onChange(o)}
          className={cx(
            "h-8 flex-1 whitespace-nowrap rounded-full px-3.5 text-sm transition-[background-color,color,box-shadow] disabled:cursor-default disabled:opacity-60",
            o === value
              ? "bg-thumb font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08),0_2px_8px_-2px_rgba(0,0,0,0.12)]"
              : "text-muted hover:text-foreground",
          )}
        >
          {format(o)}
        </button>
      ))}
    </div>
  );
}

/** A compact pill that opens the native picker (a wheel on phones). */
export function SelectChip<T extends number | string>({
  label,
  options,
  value,
  onChange,
  format,
  icon,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
  icon?: ReactNode;
}) {
  return (
    <label
      title={label}
      className="relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-fill pl-3 pr-7 text-[13px] font-medium transition-colors hover:bg-fill-strong has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground"
    >
      {icon}
      <span aria-hidden="true">{format(value)}</span>
      <IconChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-muted" />
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => onChange(options[e.target.selectedIndex])}
        className="absolute inset-0 cursor-pointer appearance-none text-base opacity-0"
      >
        {options.map((o) => (
          <option key={o} value={String(o)}>
            {format(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** An on/off chip (a checkbox underneath). */
export function Toggle({
  checked,
  onChange,
  children,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <label
      title={title}
      className={cx(
        "inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground",
        checked ? "bg-foreground text-background" : "bg-fill text-muted hover:text-foreground",
      )}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      {children}
    </label>
  );
}

export function ErrorBar({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start justify-between gap-3 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">
      <span className="min-w-0 break-words">{message}</span>
      {onClose && (
        <button onClick={onClose} className="-m-1 shrink-0 rounded-full p-1 hover:bg-bad-soft" aria-label="关闭">
          <IconX className="size-4" />
        </button>
      )}
    </p>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("inline-block animate-spin rounded-full border-2 border-current border-r-transparent opacity-70", className)}
    />
  );
}

export function DiffView({ diff, userLabel, wrongVerb }: { diff: WordDiff; userLabel: string; wrongVerb: string }) {
  return (
    <div className="space-y-2">
      <p className="text-lg leading-relaxed">
        <span className="mr-2 align-middle text-xs text-muted">原文</span>
        {diff.ref.map((w, i) => (
          <span key={i}>
            <span className={w.ok ? "" : "rounded-md bg-bad-soft px-1 text-bad"}>{w.text}</span>{" "}
          </span>
        ))}
      </p>
      {diff.user.length > 0 && (
        <p className="leading-relaxed">
          <span className="mr-2 text-xs text-muted">{userLabel}</span>
          {diff.user.map((w, i) => (
            <span key={i}>
              <span className={w.ok ? "text-muted" : "text-bad line-through"}>{w.text}</span>{" "}
            </span>
          ))}
        </p>
      )}
      {diff.wrong.length > 0 && (
        <ul className="space-y-0.5 text-sm text-muted">
          {diff.wrong.map((x, i) => (
            <li key={i}>
              <b className="font-medium text-foreground">{x.expected}</b> {wrongVerb} <b className="font-medium text-bad">{x.got}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function scoreColor(score: number) {
  return score >= 0.9 ? "text-good" : score >= 0.6 ? "text-foreground" : "text-bad";
}

export function Score({ score, label }: { score: number; label: string }) {
  return (
    <p className="flex items-baseline gap-2 text-sm text-muted">
      {label}
      <span className={cx("text-3xl font-semibold tracking-tight tabular-nums", scoreColor(score))}>{Math.round(score * 100)}%</span>
    </p>
  );
}

export function Badge({ label, score }: { label: string; score: number }) {
  return (
    <span className={cx("ml-1.5 inline-block whitespace-nowrap rounded-full bg-fill px-1.5 text-[11px] font-medium leading-5 tabular-nums", scoreColor(score))}>
      {label}
      {Math.round(score * 100)}
    </span>
  );
}

// Padding is chosen here rather than overridden in className: two padding utilities on one element fight by CSS order.
const CARD_PAD = { normal: "p-5 sm:p-6", large: "p-5 sm:p-8", roomy: "px-6 py-12 sm:py-14", none: "" };

export function Card({ children, className, pad = "normal" }: { children: ReactNode; className?: string; pad?: keyof typeof CARD_PAD }) {
  return <section className={cx("glass rounded-3xl", CARD_PAD[pad], className)}>{children}</section>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    // Wraps the action under the title when both don't fit, instead of squeezing the title onto two lines.
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A one-line input in a glass pill with a round send button, like a chat composer. */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  submitLabel,
  busy,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  submitLabel: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit();
      }}
      className="glass flex items-center gap-2 rounded-full p-1.5 pl-5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground/20"
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-subtle focus-visible:outline-none disabled:opacity-60 sm:text-[15px]"
      />
      <button
        type="submit"
        disabled={!busy && (disabled || !value.trim())}
        aria-label={submitLabel}
        aria-busy={busy}
        title={submitLabel}
        className={cx(
          "grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background transition-[opacity,transform] active:scale-95 disabled:opacity-20",
          busy && "pointer-events-none",
        )}
      >
        {busy ? <Spinner /> : <IconArrowUp className="size-[18px]" />}
      </button>
    </form>
  );
}

/** A thin progress line, 0–1. */
export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cx("h-1 overflow-hidden rounded-full bg-fill-strong", className)}
    >
      <div className="h-full rounded-full bg-foreground transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

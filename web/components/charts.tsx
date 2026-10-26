"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Small SVG charts in the app's tokens: hairline grid/axis, 2px lines, <=24px columns with 4px rounded tops,
// a hover/focus tooltip on every chart, text in ink colors (never the series color).

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * pow >= value)! * pow;
  return step;
}

const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Keep the box inside the chart horizontally.
  const left = Math.min(Math.max(x, 70), Math.max(70, width - 70));
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left, top: y - 8 }}
    >
      {children}
    </div>
  );
}

/** One series of columns over days (e.g. sentences practised per day). */
export function ColumnChart({
  data,
  height = 150,
  unit,
}: {
  data: { label: string; value: number }[];
  height?: number;
  unit: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 8, bottom: 22, left: 30 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const ticks = max % 2 === 0 ? [0, max / 2, max] : [0, max]; // counts: whole-number ticks only
  const labelEvery = Math.ceil(data.length / 6);

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`每天${unit}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} />
              <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" className="fill-muted text-[10px] tabular-nums">
                {t}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.left + band * i + band / 2;
            const top = y(d.value);
            const h = pad.top + plotH - top;
            const r = Math.min(4, barW / 2, h);
            const x0 = cx - barW / 2;
            const base = pad.top + plotH;
            return (
              <g key={d.label}>
                {d.value > 0 && (
                  <path
                    d={`M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${base} Z`}
                    fill="var(--series-1)"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" className="fill-muted text-[10px] tabular-nums">
                    {shortDate(d.label)}
                  </text>
                )}
                <rect
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.label} ${d.value}${unit}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <Tooltip x={pad.left + band * hover + band / 2} y={y(data[hover].value)} width={width}>
          <div className="font-semibold text-foreground">
            {data[hover].value} {unit}
          </div>
          <div className="text-muted">{data[hover].label}</div>
        </Tooltip>
      )}
    </div>
  );
}

export type LineSeries = { name: string; color: string; values: (number | null)[] };

/** Percent lines over days (0–100%), gaps where there's no data. Crosshair tooltip lists every series. */
export function PercentLines({ labels, series, height = 170 }: { labels: string[]; series: LineSeries[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 12, bottom: 22, left: 36 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (labels.length > 1 ? (i / (labels.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => pad.top + plotH - v * plotH;
  const labelEvery = Math.ceil(labels.length / 6);

  const pathFor = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i)},${y(v)} `;
      pen = true;
    });
    return d;
  };

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setHover(Math.round(rel * (labels.length - 1)));
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join("、") + "的每日平均分"}>
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} />
                <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" className="fill-muted text-[10px] tabular-nums">
                  {t * 100}%
                </text>
              </g>
            ))}
            {labels.map((l, i) =>
              i % labelEvery === 0 ? (
                <text key={l} x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted text-[10px] tabular-nums">
                  {shortDate(l)}
                </text>
              ) : null,
            )}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} stroke="var(--axis)" />}
            {series.map((s) => (
              <g key={s.name}>
                <path d={pathFor(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {s.values.map((v, i) =>
                  v === null ? null : (
                    <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                  ),
                )}
              </g>
            ))}
            <rect
              x={pad.left}
              y={pad.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}
        {hover !== null && (
          <Tooltip x={x(hover)} y={pad.top + 4} width={width}>
            <div className="mb-0.5 text-muted">{labels[hover]}</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                <span className="font-semibold text-foreground">
                  {s.values[hover] === null ? "—" : `${Math.round(s.values[hover]! * 100)}%`}
                </span>
                <span className="text-muted">{s.name}</span>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** Before → after per row on a shared scale (e.g. retell speed, first round vs last round). */
export function Dumbbells({ rows, unit }: { rows: { label: string; from: number; to: number }[]; unit: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = niceMax(Math.max(1, ...rows.flatMap((r) => [r.from, r.to])));
  const left = 8;
  const right = 40;
  const sx = (v: number) => left + (v / max) * Math.max(0, width - left - right);
  return (
    <div ref={ref} className="space-y-2">
      {width > 0 &&
        rows.map((r, i) => (
          <div key={i} className="space-y-0.5">
            <div className="truncate text-xs text-muted">{r.label}</div>
            <svg width={width} height={18} role="img" aria-label={`${r.label}：${r.from} → ${r.to} ${unit}`}>
              <line x1={sx(0)} x2={width - right} y1={9} y2={9} stroke="var(--grid)" />
              <line x1={sx(r.from)} x2={sx(r.to)} y1={9} y2={9} stroke="var(--series-1)" strokeWidth={2} opacity={0.5} />
              <circle cx={sx(r.from)} cy={9} r={4} fill="var(--series-1)" opacity={0.45} stroke="var(--surface)" strokeWidth={2} />
              <circle cx={sx(r.to)} cy={9} r={5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
              <text x={Math.max(sx(r.to), sx(r.from)) + 9} y={13} className="fill-foreground text-[11px] tabular-nums">
                {r.from}→{r.to}
              </text>
            </svg>
          </div>
        ))}
    </div>
  );
}

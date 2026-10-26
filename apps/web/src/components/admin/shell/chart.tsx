"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@open-lms/ui";

// ─── Pure helpers (tested in test/admin/chart.test.ts) ──────────────────────

/** A "nice" axis for counts starting at zero: ticks at 1, 2, 2.5 or 5 times a power of ten. */
export function niceTicks(max: number, target = 4, integer = true): { ticks: number[]; max: number } {
  if (!Number.isFinite(max) || max <= 0) return { ticks: [0, 1], max: 1 };
  const raw = max / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  // Counts are whole numbers: never a fractional step.
  const s = integer ? Math.max(1, step) : step;
  const top = Math.ceil(max / s) * s;
  const ticks: number[] = [];
  for (let v = 0; v <= top + s / 1e6; v += s) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, max: top };
}

/** Linear map from a domain to a range. */
export function scaleLinear([d0, d1]: [number, number], [r0, r1]: [number, number]) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Index of the data point closest to x for `n` points spread across [left, right]. */
export function indexAt(x: number, n: number, left: number, right: number): number {
  if (n <= 1) return 0;
  const t = (x - left) / (right - left || 1);
  return Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))));
}

/** Which x positions get a date label: about `max` evenly spaced, first and last included. */
export function labelIndexes(n: number, max = 6): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (max - 1);
  return [...new Set(Array.from({ length: max }, (_, i) => Math.round(i * step)))];
}

/** "Mar 4" for an ISO day (YYYY-MM-DD), read as a calendar date (no timezone shift). */
export function formatDay(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }, locale?: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Axis figures: 950, 1.2K. */
export function formatTick(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}

// ─── Component ──────────────────────────────────────────────────────────────

export type ChartTone = "primary" | "brand" | "success" | "warning" | "danger" | "muted";
const TONE: Record<ChartTone, string> = {
  primary: "hsl(var(--primary))",
  brand: "hsl(var(--brand))",
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  danger: "hsl(var(--danger))",
  muted: "hsl(var(--muted-foreground))",
};

export interface ChartSeries {
  key: string;
  label: string;
  tone?: ChartTone;
}

export interface ChartProps<D extends { date: string }> {
  data: D[];
  series: ChartSeries[];
  type?: "line" | "bar";
  height?: number;
  /** Names the chart for screen readers and the table caption. */
  title: string;
  formatValue?: (n: number) => string;
  className?: string;
  testId?: string;
}

const M = { top: 12, right: 12, bottom: 26, left: 40 };

/** A dependency-free SVG line or bar chart over daily data: axes, gridlines, hover tooltip, table view. */
export function Chart<D extends { date: string }>({ data, series, type = "line", height = 240, title, formatValue = (n) => formatTick(n), className, testId = "chart" }: ChartProps<D>) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const val = (d: D, k: string) => Number((d as Record<string, unknown>)[k] ?? 0) || 0;
  const maxVal = useMemo(() => Math.max(0, ...data.flatMap((d) => series.map((s) => val(d, s.key)))), [data, series]); // eslint-disable-line react-hooks/exhaustive-deps
  const axis = niceTicks(maxVal);
  const left = M.left;
  const right = width - M.right;
  const bottom = height - M.bottom;
  const y = scaleLinear([0, axis.max], [bottom, M.top]);
  const n = data.length;
  const band = n ? (right - left) / n : 0;
  const xLine = (i: number) => (n <= 1 ? (left + right) / 2 : left + (i / (n - 1)) * (right - left));
  const xBar = (i: number) => left + band * i + band / 2;
  const x = type === "bar" ? xBar : xLine;
  const labels = labelIndexes(n, width < 480 ? 4 : 7);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    setHover(type === "bar" ? Math.min(n - 1, Math.max(0, Math.floor((px - left) / (band || 1)))) : indexAt(px, n, left, right));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!n) return;
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === "Home") setHover(0);
    else if (e.key === "End") setHover(n - 1);
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  const barW = Math.max(2, Math.min(28, band / Math.max(1, series.length) - 2));
  const hovered = hover !== null ? data[hover] : undefined;
  const tipLeft = hover !== null ? (x(hover) / width) * 100 : 0;

  return (
    <figure className={cn("min-w-0", className)} data-testid={testId}>
      {series.length > 1 ? (
        <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: TONE[s.tone ?? "primary"] }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div ref={wrap} className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}. Use the arrow keys to read each day, or open the table view.`}
          tabIndex={0}
          onPointerMove={pick}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="block touch-pan-y overflow-visible rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {axis.ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke="hsl(var(--border))" strokeDasharray={t === 0 ? undefined : "2 4"} />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="hsl(var(--subtle-foreground))" className="tabular-nums">
                {formatValue(t)}
              </text>
            </g>
          ))}
          {labels.map((i) => (
            <text key={i} x={x(i)} y={height - 6} textAnchor={n > 1 && i === 0 && type === "line" ? "start" : n > 1 && i === n - 1 && type === "line" ? "end" : "middle"} fontSize={11} fill="hsl(var(--subtle-foreground))">
              {formatDay(data[i]!.date)}
            </text>
          ))}
          {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={bottom} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.45} /> : null}
          {type === "bar"
            ? data.map((d, i) =>
                series.map((s, si) => {
                  const v = val(d, s.key);
                  const h = Math.max(0, bottom - y(v));
                  const bx = xBar(i) - (barW * series.length) / 2 + si * barW + 1;
                  return (
                    <rect
                      key={`${d.date}-${s.key}`}
                      x={bx}
                      y={bottom - h}
                      width={Math.max(1, barW - 2)}
                      height={h}
                      rx={Math.min(3, barW / 2)}
                      fill={TONE[s.tone ?? "primary"]}
                      fillOpacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  );
                }),
              )
            : series.map((s) => {
                const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(val(d, s.key)).toFixed(1)}`).join(" ");
                return (
                  <g key={s.key}>
                    <polyline points={pts} fill="none" stroke={TONE[s.tone ?? "primary"]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {hover !== null && hovered ? <circle cx={x(hover)} cy={y(val(hovered, s.key))} r={4} fill={TONE[s.tone ?? "primary"]} stroke="hsl(var(--card))" strokeWidth={2} /> : null}
                  </g>
                );
              })}
        </svg>
        {hovered ? (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute top-0 z-10 min-w-[140px] -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-[12.5px] text-popover-foreground shadow-popover"
            style={{ left: `clamp(70px, ${tipLeft}%, calc(100% - 70px))` }}
          >
            <p className="font-semibold">{formatDay(hovered.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>
            {series.map((s) => (
              <p key={s.key} className="mt-0.5 flex items-center justify-between gap-4 text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: TONE[s.tone ?? "primary"] }} />
                  {s.label}
                </span>
                <span className="font-semibold tabular-nums text-foreground">{formatValue(val(hovered, s.key))}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex justify-end">
        <button type="button" className="text-[12.5px] font-medium text-link hover:underline" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Hide table" : "View as table"}
        </button>
      </div>
      <div id={tableId} className={showTable ? "mt-2 max-h-72 overflow-y-auto" : "sr-only"}>
        <table className="w-full text-left text-[13px]">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="py-1.5 pr-4 font-medium">Date</th>
              {series.map((s) => (
                <th key={s.key} scope="col" className="py-1.5 pr-4 text-right font-medium last:pr-0">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date} className="border-b border-border last:border-0">
                <th scope="row" className="py-1.5 pr-4 font-normal">{formatDay(d.date, { month: "short", day: "numeric", year: "numeric" })}</th>
                {series.map((s) => (
                  <td key={s.key} className="py-1.5 pr-4 text-right tabular-nums last:pr-0">
                    {formatValue(val(d, s.key))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

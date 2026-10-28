"use client";

import { animate, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/*
  Creator analytics charts — plain SVG (the app has no chart library; features/studio draws its own the same way) with
  framer-motion for the motion the design asks for:
    · lines draw in left to right (600ms) the first time, then MORPH to a new period's data (never re-mount)
    · bars grow from 0 with a spring, 20ms apart
    · numbers roll to a new value over 400ms
  Reduce Motion: no draw-in, no morph, no roll — a short cross-fade instead. Every chart takes an accessible summary;
  the interactive bars are real buttons (focusable, a selection haptic on tap).
*/

type Pt = [number, number];

/** A Catmull-Rom curve through the points, as cubic Béziers (the design's smooth()). */
export function smoothPath(pts: Pt[]): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Map values onto a w×h box (top padding for the end dot); a flat or empty series sits on the baseline. */
export function toPoints(values: number[], w: number, h: number, max?: number, pad = 8): Pt[] {
  const n = values.length;
  const top = Math.max(max ?? 0, ...values, 0);
  return values.map((v, i) => [n === 1 ? w / 2 : (i / (n - 1)) * w, top > 0 ? h - pad - (Math.max(0, v) / top) * (h - pad * 2) : h - pad]);
}

/** Resample to a fixed number of points so a period change morphs between paths of the same shape. */
export function resample(values: number[], n: number): number[] {
  if (values.length === 0) return Array(n).fill(0);
  if (values.length === n) return values;
  return Array.from({ length: n }, (_, i) => {
    const x = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(x);
    const hi = Math.min(values.length - 1, lo + 1);
    return values[lo]! + (values[hi]! - values[lo]!) * (x - lo);
  });
}

const SAMPLES = 48;

export interface LineSeries {
  values: number[];
  /** CSS colour (a var(--ca-…) token) */
  stroke: string;
  fill?: string;
  dashed?: boolean;
  width?: number;
}

/**
 * A smooth line (or two) with a gradient fill, minimal dashed grid, an end dot, optional x labels underneath and a
 * drag scrubber. Several series share one scale (the second is e.g. "your average", dashed).
 */
export function LineChart({
  series,
  height = 110,
  ariaLabel,
  labels,
  grid = true,
  endDot = true,
  dark = false,
  scrub,
  className,
}: {
  series: LineSeries[];
  height?: number;
  ariaLabel: string;
  labels?: string[];
  grid?: boolean;
  endDot?: boolean;
  dark?: boolean;
  /** formats the scrubber readout for point i; omit to disable scrubbing */
  scrub?: (i: number) => string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const W = 320;
  const H = height;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const paths = series.map((s) => {
    const pts = toPoints(resample(s.values, SAMPLES), W, H, max);
    const line = smoothPath(pts);
    return { line, area: `${line} L${W},${H} L0,${H} Z`, end: pts[pts.length - 1]! };
  });
  const [drawn, setDrawn] = useState(false);
  useEffect(() => setDrawn(true), []);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const n = series[0]?.values.length ?? 0;
  const onMove = (clientX: number) => {
    if (!scrub || !svgRef.current || n < 2) return;
    const r = svgRef.current.getBoundingClientRect();
    const i = Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (n - 1));
    setHover(i);
  };
  const hx = hover === null || n < 2 ? null : (hover / (n - 1)) * W;
  const t = reduce ? { duration: 0 } : { duration: 0.45, ease: "easeInOut" as const };
  return (
    <div className={cn("relative", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        className="block touch-pan-y overflow-visible"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          {series.map((s, i) =>
            s.fill ? (
              <linearGradient key={i} id={`${id}-f${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.fill} stopOpacity={dark ? 0.35 : 0.2} />
                <stop offset="1" stopColor={s.fill} stopOpacity="0" />
              </linearGradient>
            ) : null,
          )}
        </defs>
        {grid ? <path d={`M0 ${H / 3}H${W}M0 ${(H * 2) / 3}H${W}`} stroke={dark ? "rgba(255,255,255,.08)" : "var(--ca-track)"} strokeDasharray="3 5" vectorEffect="non-scaling-stroke" /> : null}
        {paths.map((p, i) => (
          <g key={i}>
            {series[i]!.fill ? <motion.path initial={false} animate={{ d: p.area }} transition={t} fill={`url(#${id}-f${i})`} /> : null}
            <motion.path
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ d: p.line, pathLength: 1 }}
              transition={reduce ? { duration: 0 } : { d: t, pathLength: { duration: drawn ? 0 : 0.6, ease: "easeOut" } }}
              fill="none"
              stroke={series[i]!.stroke}
              strokeWidth={series[i]!.width ?? 2.4}
              strokeLinecap="round"
              strokeDasharray={series[i]!.dashed ? "4 5" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {endDot && paths[0] && n > 0 ? (
          <>
            <motion.circle initial={false} animate={{ cx: paths[0].end[0], cy: paths[0].end[1] }} transition={t} r={8} fill={series[0]!.stroke} opacity={0.22} />
            <motion.circle initial={false} animate={{ cx: paths[0].end[0], cy: paths[0].end[1] }} transition={t} r={4} fill="#fff" stroke={series[0]!.stroke} strokeWidth={2.4} />
          </>
        ) : null}
        {hx !== null ? <line x1={hx} x2={hx} y1={0} y2={H} stroke={dark ? "rgba(255,255,255,.5)" : "var(--ca-muted)"} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      {scrub && hover !== null ? (
        <span aria-live="polite" className={cn("pointer-events-none absolute -top-2 rounded-lg px-2 py-0.5 text-xs font-bold shadow", dark ? "bg-white text-[var(--ca-ink)]" : "bg-[var(--ca-ink)] text-white")} style={{ left: `clamp(0px, calc(${((hover / Math.max(1, n - 1)) * 100).toFixed(1)}% - 40px), calc(100% - 90px))` }}>
          {scrub(hover)}
        </span>
      ) : null}
      {labels?.length ? (
        <div className={cn("mt-2 flex justify-between text-[11px] font-medium", dark ? "text-white/65" : "text-[var(--ca-muted)]")} aria-hidden>
          {labels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Sparkline({ values, stroke = "var(--ca-blue)", height = 54, ariaLabel }: { values: number[]; stroke?: string; height?: number; ariaLabel?: string }) {
  return <LineChart series={[{ values, stroke, fill: stroke, width: 2.2 }]} height={height} grid={false} endDot={false} ariaLabel={ariaLabel ?? "Trend"} />;
}

/**
 * Vertical bars that grow with a spring (20ms stagger) and morph when the data changes. With `onSelect` each bar is a
 * button: tapping selects it (a selection haptic) and the caller shows its readout.
 */
export function Bars({
  values,
  labels,
  highlight,
  height = 120,
  color = "var(--ca-blue-tint)",
  activeColor = "linear-gradient(180deg,var(--ca-blue),var(--ca-violet))",
  ariaLabel,
  barLabel,
  onSelect,
  showValues,
  dark,
  gap = 6,
}: {
  values: number[];
  labels?: string[];
  highlight?: number | null;
  height?: number;
  color?: string;
  activeColor?: string;
  ariaLabel: string;
  /** the accessible name of bar i (interactive bars) */
  barLabel?: (i: number) => string;
  onSelect?: (i: number) => void;
  showValues?: (i: number) => string;
  dark?: boolean;
  gap?: number;
}) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...values);
  return (
    <div role={onSelect ? "group" : "img"} aria-label={ariaLabel}>
      <div className="flex items-end" style={{ height, gap }}>
        {values.map((v, i) => {
          const h = Math.max(v > 0 ? 4 : 2, (v / max) * height);
          const active = highlight === i;
          const bar = (
            <motion.span
              aria-hidden
              initial={reduce ? false : { height: 0 }}
              animate={{ height: h }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 26, delay: i * 0.02 }}
              className="block w-full rounded-t-[8px] rounded-b-[4px]"
              style={{ background: active ? activeColor : color, boxShadow: active && !dark ? "0 6px 14px rgba(37,99,235,.3)" : undefined }}
            />
          );
          return (
            <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              {showValues ? <b className={cn("text-[11px] font-semibold", dark ? "text-white/80" : "text-[var(--ca-ink)]")}>{showValues(i)}</b> : null}
              {onSelect ? (
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={barLabel?.(i)}
                  onClick={() => {
                    haptic("selection");
                    onSelect(i);
                  }}
                  className="flex h-full w-full items-end rounded-t-[8px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-blue)]"
                >
                  {bar}
                </button>
              ) : (
                bar
              )}
            </div>
          );
        })}
      </div>
      {labels?.length ? (
        <div className="mt-1.5 flex" style={{ gap }} aria-hidden>
          {labels.map((l, i) => (
            <span key={i} className={cn("min-w-0 flex-1 truncate text-center text-[11px]", dark ? "text-white/70" : "text-[var(--ca-sub)]")}>
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface Part {
  label: string;
  value: number;
  color: string;
}

/** One stacked bar with a legend underneath ("Interaction mix", "Where views come from"). */
export function StackedBar({ parts, ariaLabel, height = 12, legend = true, format }: { parts: Part[]; ariaLabel: string; height?: number; legend?: boolean; format?: (v: number, share: number) => string }) {
  const reduce = useReducedMotion();
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="flex gap-0.5 overflow-hidden rounded-full bg-[var(--ca-track)]" style={{ height }}>
        {total > 0
          ? parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <motion.span key={p.label} initial={false} animate={{ flexGrow: p.value }} transition={reduce ? { duration: 0 } : { duration: 0.4 }} style={{ background: p.color, flexBasis: 0 }} />
              ))
          : null}
      </div>
      {legend ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--ca-sub)]">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-1.5">
              <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
              {p.label}
              {format ? <b className="text-[var(--ca-ink)]">{format(p.value, total > 0 ? (p.value / total) * 100 : 0)}</b> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A horizontal progress bar (gradient fill), e.g. top locations and styles. */
export function Progress({ share, color = "var(--ca-brand-bar)" }: { share: number; color?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--ca-track)]" aria-hidden>
      <motion.i initial={reduce ? false : { width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, share))}%` }} transition={reduce ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }} className="block h-full rounded-full" style={{ background: color }} />
    </div>
  );
}

/** The 7 × 6 "most active times" grid, in the creator's time zone, with a legend. */
export function Heatmap({ grid, rows, cols, ariaLabel }: { grid: number[][]; rows: readonly string[]; cols: readonly string[]; ariaLabel: string }) {
  const max = Math.max(1, ...grid.flat());
  const shade = (v: number) => (v <= 0 ? "var(--ca-track)" : `color-mix(in srgb, var(--ca-blue) ${Math.round(15 + (v / max) * 85)}%, white)`);
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="mt-3.5 grid items-center gap-[5px]" style={{ gridTemplateColumns: `36px repeat(${cols.length}, minmax(0,1fr))` }}>
        <span />
        {cols.map((c) => (
          <span key={c} className="text-center text-[11px] text-[var(--ca-muted)]">
            {c}
          </span>
        ))}
        {rows.map((r, ri) => (
          <div key={r} className="contents">
            <span className="text-left text-xs font-medium text-[var(--ca-sub)]">{r}</span>
            {cols.map((_, ci) => (
              <i key={ci} className="block h-[30px] rounded-[8px]" style={{ background: shade(grid[ri]?.[ci] ?? 0) }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-[var(--ca-muted)]" aria-hidden>
        Less
        {[0, 0.25, 0.5, 0.75, 1].map((s) => (
          <i key={s} className="inline-block h-3 w-3 rounded-[3px]" style={{ background: shade(s * max) }} />
        ))}
        More
      </div>
    </div>
  );
}

/** A number that rolls to its new value over 400ms (instant under Reduce Motion). */
export function RollingNumber({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const c = animate(from.current, value, { duration: 0.4, ease: "easeOut", onUpdate: (v) => setShown(v) });
    from.current = value;
    return () => c.stop();
  }, [value, reduce]);
  const text = useMemo(() => format(shown), [format, shown]);
  return (
    <span className={className} aria-label={format(value)}>
      <span aria-hidden>{text}</span>
    </span>
  );
}

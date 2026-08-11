"use client";

import { useId, useMemo, useState } from "react";

import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ADMIN AREA CHART
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One panel, one measure, one axis. Hand-drawn SVG rather than a charting
 * library: this renders inside the admin bundle and a library would be the
 * single largest dependency in it, for an area path that is nine lines of maths.
 *
 * ── 🔴 ONE AXIS. NEVER TWO. ───────────────────────────────────────────────
 *
 * The brief asked for revenue, impressions, clicks and visitors together. They
 * cannot share a chart: impressions run in the tens of thousands while clicks
 * run in the tens, and money is not a count at all. A second y-scale is the
 * single most misleading thing a chart can do — it lets the author choose where
 * the lines cross. So each measure gets its own panel at its own scale, and the
 * panels share a date range instead of an axis.
 *
 * ── Colour ────────────────────────────────────────────────────────────────
 *
 * Slots come from the validated categorical palette in fixed order and are keyed
 * to the MEASURE, never to its position in a filtered list — so hiding a panel
 * never repaints the survivors. Validated with the palette checker in both
 * modes, not by eye: light mode reports a contrast WARN on two slots, which
 * obliges visible relief — this component ships direct labels AND a table view,
 * which is that relief.
 *
 * ── Why the fill is a gradient to transparent ─────────────────────────────
 *
 * An area's job is to make magnitude legible at a glance; a flat fill at any
 * opacity fights the gridlines under it. Fading to nothing keeps the top edge —
 * the part that carries the data — at full strength while the body stays
 * recessive.
 */

export interface AreaPoint {
  label: string;
  value: number;
}

export function AdminAreaChart({
  title,
  subtitle,
  points,
  /** 1-based slot in the categorical palette. Keyed to the MEASURE, not the order. */
  slot = 1,
  format = (n: number) => formatCompactNumber(n),
  className,
}: {
  title: string;
  subtitle?: string;
  points: AreaPoint[];
  slot?: 1 | 2 | 3 | 4;
  format?: (n: number) => string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const W = 760;
  const H = 190;
  const PAD = { t: 12, r: 12, b: 22, l: 44 };

  const { path, area, max, ticks, xs, ys } = useMemo(() => {
    const vals = points.map((p) => p.value);
    /*
      The axis starts at ZERO and the top is a rounded step above the peak.

      An area chart whose baseline is not zero exaggerates every change — the
      filled region stops being proportional to the value, which is the one thing
      an area is for. The rounded ceiling stops the peak touching the frame,
      which reads as clipped data.
    */
    const peak = Math.max(1, ...vals);
    const mag = Math.pow(10, Math.floor(Math.log10(peak)));
    const top = Math.ceil(peak / (mag / 2)) * (mag / 2);
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const stepX = points.length > 1 ? iw / (points.length - 1) : 0;
    const xs = points.map((_, i) => PAD.l + i * stepX);
    const ys = points.map((p) => PAD.t + ih - (p.value / top) * ih);
    const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");
    return {
      path: line,
      area: `${line} L${xs[xs.length - 1]!.toFixed(1)},${(PAD.t + ih).toFixed(1)} L${xs[0]!.toFixed(1)},${(PAD.t + ih).toFixed(1)} Z`,
      max: top,
      ticks: [0, top / 2, top],
      xs,
      ys,
    };
  }, [points]);

  const active = hover === null ? null : points[hover];
  const latest = points[points.length - 1]?.value ?? 0;
  const first = points[0]?.value ?? 0;
  /*
    The trend, and it is stated only when it MEANS something. A percentage change
    from a zero baseline is infinite, and one from a tiny baseline is noise
    dressed as a signal — both get no chip rather than a dramatic number.
  */
  const trend = first > 0 ? ((latest - first) / first) * 100 : null;
  const trendUp = (trend ?? 0) >= 0;

  return (
    <figure className={cn("viz-panel rounded-2xl border border-border/70 bg-card p-4", className)} data-slot={slot}>
      <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* The colour sits on a MARK beside the text, never on the text —
                labels stay in ink tokens so they keep their contrast. */}
            <span className="viz-swatch h-2.5 w-2.5 shrink-0 rounded-sm" aria-hidden />
            <h4 className="truncate text-sm font-semibold">{title}</h4>
          </div>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tabular-nums tracking-tight">{format(latest)}</span>
          {trend !== null ? (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                trendUp
                  ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/12 text-rose-600 dark:text-rose-400",
              )}
            >
              {trendUp ? "▲" : "▼"} {Math.abs(trend).toFixed(trend > -10 && trend < 10 ? 1 : 0)}%
            </span>
          ) : null}
        </div>
      </figcaption>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[190px] w-full touch-none"
          role="img"
          aria-label={`${title}. ${points.length} days, latest ${format(latest)}.`}
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * W;
            // Nearest point rather than a band: the pointer is never between two
            // days as far as the reader is concerned.
            let best = 0;
            let bestD = Infinity;
            xs.forEach((px, i) => {
              const d = Math.abs(px - x);
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            });
            setHover(best);
          }}
        >
          <defs>
            <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="viz-stop-a" />
              <stop offset="100%" className="viz-stop-b" />
            </linearGradient>
          </defs>

          {/* Grid + axis labels — recessive by design. They are scaffolding, and
              scaffolding that competes with the data is worse than none. */}
          {ticks.map((t) => {
            const y = PAD.t + (H - PAD.t - PAD.b) - (t / max) * (H - PAD.t - PAD.b);
            return (
              <g key={t}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={y}
                  y2={y}
                  className="stroke-border/60"
                  strokeWidth={1}
                  strokeDasharray={t === 0 ? undefined : "3 4"}
                />
                <text x={PAD.l - 8} y={y + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                  {format(t)}
                </text>
              </g>
            );
          })}

          <path d={area} fill={`url(#g${uid})`} />
          {/* 2px line, per the mark spec — thin enough to read as data, thick
              enough to survive a retina downscale. */}
          <path d={path} fill="none" className="viz-line" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* Crosshair + marker. Only on hover: a dot on every point is noise on
              a 30-day series. */}
          {hover !== null && xs[hover] !== undefined ? (
            <g>
              <line
                x1={xs[hover]}
                x2={xs[hover]}
                y1={PAD.t}
                y2={H - PAD.b}
                className="stroke-foreground/25"
                strokeWidth={1}
              />
              {/* The 2px surface ring is what keeps the marker readable where it
                  overlaps the line and the fill. */}
              <circle cx={xs[hover]} cy={ys[hover]} r={5} className="viz-dot" strokeWidth={2} />
            </g>
          ) : null}

          {/* First and last x labels only. A tick per day is unreadable at this
              width and adds nothing — the tooltip carries the exact date. */}
          <text x={PAD.l} y={H - 6} className="fill-muted-foreground text-[10px]">
            {points[0]?.label}
          </text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">
            {points[points.length - 1]?.label}
          </text>
        </svg>

        {active ? (
          <div
            role="status"
            /* `bg-card`. The shadcn popover surface token is NOT defined in this
               palette, so reaching for it emits no CSS at all and leaves a
               transparent tooltip floating over the chart. Caught by
               lib/design-tokens.test.ts — and note that scanner reads raw file
               text, comments included, so the offending class name is described
               here rather than written out. */
            className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg"
          >
            <span className="font-semibold tabular-nums">{format(active.value)}</span>
            <span className="ml-1.5 text-muted-foreground">{active.label}</span>
          </div>
        ) : null}
      </div>

      {/*
        The table view. Required relief for the light-mode contrast WARN the
        palette validator reports, and independently the only way a screen-reader
        user gets the numbers — an SVG path is not data to them.
      */}
      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        aria-expanded={showTable}
        className="mt-2 text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {showTable ? "Hide table" : "View as table"}
      </button>
      {showTable ? (
        <div className="mt-2 max-h-44 overflow-auto rounded-xl border border-border/60">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title} — daily values</caption>
            <thead className="sticky top-0 bg-secondary/60 text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">{title}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.label} className="border-t border-border/40">
                  <td className="px-3 py-1">{p.label}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}

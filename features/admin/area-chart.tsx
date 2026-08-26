"use client";

import { ChevronDown, Maximize2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { axisLabelIndices, axisScale } from "@/lib/monetization/revenue-aggregate";
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
 *
 * ── Expand-on-click (owner, 2026-08-16) ────────────────────────────────────
 *
 * The card view is deliberately small — it has to sit next to three siblings.
 * Clicking it (or the explicit expand button) portals a larger render of the
 * SAME geometry function at bigger W/H into `document.body`, so the reader gets
 * a genuinely bigger chart rather than a CSS-stretched, letterboxed one. The
 * geometry helper is shared between both sizes so the two views never drift.
 */

export interface AreaPoint {
  /** The terse x-axis tick — "8/3". Search Console's format. */
  label: string;
  value: number;
  /**
   * The unambiguous form for the TOOLTIP — "Aug 3–9, 2026".
   *
   * The axis and the tooltip want different things and it took the owner's
   * side-by-side comparison against Search Console to make that obvious: "8/3"
   * on the axis is what lets a dozen dates sit on one line, but "8/3" alone in
   * a tooltip does not say whether you are looking at one day or the seven that
   * start on it. Optional — a caller with nothing richer to say falls back to
   * `label` and nothing changes.
   */
  fullLabel?: string;
}

interface Pad {
  t: number;
  r: number;
  b: number;
  l: number;
}

function useChartGeometry(
  points: AreaPoint[],
  width: number,
  height: number,
  pad: Pad,
  /** The same window, one period earlier — drawn as the comparison line. */
  compare?: AreaPoint[],
) {
  return useMemo(() => {
    /*
      🔴 THE Y SCALE IS SHARED WITH THE COMPARISON SERIES.

      Scaling the two lines independently is the single most misleading thing
      this chart could do: a previous period drawn to its own ceiling would sit
      at the same height as the current one no matter how different the numbers
      are, and the entire point of the overlay is to show that difference. One
      `axisScale` call over BOTH sets of values.

      `axisScale` (lib/monetization/revenue-aggregate.ts) replaces the
      hand-rolled ceiling that used to live here — it is the tested version of
      the same idea (zero baseline, clean 1/2/5 step above the peak), and it
      returns real ticks instead of assuming three.
    */
    const all = [...points.map((p) => p.value), ...(compare ?? []).map((p) => p.value)];
    const { top, ticks } = axisScale(all);

    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const stepX = points.length > 1 ? iw / (points.length - 1) : 0;
    const xs = points.map((_, i) => pad.l + i * stepX);
    const yFor = (v: number) => pad.t + ih - (v / top) * ih;
    const ys = points.map((p) => yFor(p.value));
    const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");

    /*
      The comparison path is indexed against the CURRENT series' x positions, so
      bucket 3 of last period sits directly under bucket 3 of this one. That
      vertical alignment is what makes "this Tuesday vs last Tuesday" readable
      at a glance, and it is why both series must have the same length.
    */
    const cmpYs = (compare ?? []).slice(0, points.length).map((p) => yFor(p.value));
    const cmpPath = cmpYs.length > 1
      ? cmpYs.map((y, i) => `${i === 0 ? "M" : "L"}${xs[i]!.toFixed(1)},${y.toFixed(1)}`).join(" ")
      : "";

    return {
      path: line,
      area: `${line} L${xs[xs.length - 1]!.toFixed(1)},${(pad.t + ih).toFixed(1)} L${xs[0]!.toFixed(1)},${(pad.t + ih).toFixed(1)} Z`,
      max: top,
      ticks,
      xs,
      ys,
      cmpPath,
      cmpYs,
    };
  }, [points, compare, width, height, pad.t, pad.r, pad.b, pad.l]);
}

/** The SVG body alone — reused at card size and at expanded-modal size. */
function ChartSvg({
  title,
  points,
  format,
  width,
  height,
  labelPx = 10,
  compare,
  compareLabel,
}: {
  title: string;
  points: AreaPoint[];
  format: (n: number) => string;
  width: number;
  height: number;
  labelPx?: number;
  compare?: AreaPoint[];
  compareLabel?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const PAD: Pad = { t: 12, r: 12, b: 22, l: labelPx > 10 ? 56 : 44 };
  const { path, area, max, ticks, xs, ys, cmpPath, cmpYs } = useChartGeometry(
    points,
    width,
    height,
    PAD,
    compare,
  );
  const active = hover === null ? null : points[hover];
  const activeCmp = hover === null ? null : compare?.[hover];
  const latest = points[points.length - 1]?.value ?? 0;

  /*
    Which x positions get a printed label (§5). Search Console prints as many
    dates as fit and leaves the rest to the tooltip — every point is still
    hoverable, only the LABEL is thinned. This replaces "first and last only",
    which told you the range and nothing about where in it you were looking.

    The divisor is the practical width of one date label at this font size;
    fewer labels on the small card, more in the expanded modal, derived rather
    than hardcoded per call site.
  */
  const labelled = axisLabelIndices(points.length, Math.max(2, Math.floor((width - PAD.l - PAD.r) / (labelPx * 6))));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none"
        style={{ height }}
        role="img"
        aria-label={`${title}. ${points.length} days, latest ${format(latest)}.`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * width;
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
          const y = PAD.t + (height - PAD.t - PAD.b) - (t / max) * (height - PAD.t - PAD.b);
          return (
            <g key={t}>
              <line
                x1={PAD.l}
                x2={width - PAD.r}
                y1={y}
                y2={y}
                className="stroke-border/60"
                strokeWidth={1}
                strokeDasharray={t === 0 ? undefined : "3 4"}
              />
              <text x={PAD.l - 8} y={y + 3.5} textAnchor="end" className="fill-muted-foreground tabular-nums" style={{ fontSize: labelPx }}>
                {format(t)}
              </text>
            </g>
          );
        })}

        {/*
          ── VERTICAL DOTTED GRIDLINES (owner, 2026-08-25, from the Search
             Console screenshots) ────────────────────────────────────────────

          One per LABELLED tick, not one per data point: a dotted line behind
          every day of a 90-day series is a grey wash, and Search Console draws
          them only where a date is printed. They are what visually ties a point
          on the curve to the date under it, which is the job the axis was
          failing at when every label but the first and last was missing.

          Drawn BEFORE the area and the line so the data always sits on top —
          scaffolding that crosses in front of the curve reads as part of it.
        */}
        {points.map((p, i) =>
          labelled.has(i) && xs[i] !== undefined ? (
            <line
              key={`vg${p.label}${i}`}
              x1={xs[i]}
              x2={xs[i]}
              y1={PAD.t}
              y2={height - PAD.b}
              className="stroke-border/70"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
          ) : null,
        )}

        <path d={area} fill={`url(#g${uid})`} />

        {/*
          ── THE PREVIOUS PERIOD (Search Console's comparison line) ───────────
          Drawn BEFORE the current series so the current one is never obscured
          by it, and with NO fill: two filled areas overlapping produce a third
          colour that means nothing, and the reader cannot tell which region
          belongs to which period.

          Dashed and muted, because it is reference rather than data. The whole
          job of this line is to let the eye answer "is today's shape above or
          below where we were" without reading a single number.
        */}
        {cmpPath ? (
          <path
            d={cmpPath}
            fill="none"
            className="stroke-muted-foreground/45"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

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
              y2={height - PAD.b}
              className="stroke-foreground/25"
              strokeWidth={1}
            />
            {/* The comparison marker is hollow, so the two can never be
                confused when they sit close together. */}
            {cmpYs[hover] !== undefined ? (
              <circle
                cx={xs[hover]}
                cy={cmpYs[hover]}
                r={3.5}
                fill="none"
                className="stroke-muted-foreground/70"
                strokeWidth={2}
              />
            ) : null}
            {/* The 2px surface ring is what keeps the marker readable where it
                overlaps the line and the fill. */}
            <circle cx={xs[hover]} cy={ys[hover]} r={5} className="viz-dot" strokeWidth={2} />
          </g>
        ) : null}

        {/*
          Thinned date labels, not just the two ends. `axisLabelIndices` pins
          the first and last (an axis whose ends are unlabelled does not say
          what range you are looking at) and spreads the rest evenly.

          `textAnchor` shifts at the ends so neither label overhangs the
          drawing area — a middle label is centred on its point, but the first
          and last would hang off the left and right edges.
        */}
        {points.map((p, i) =>
          labelled.has(i) ? (
            <text
              key={p.label + i}
              x={xs[i]}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              className="fill-muted-foreground"
              style={{ fontSize: labelPx }}
            >
              {p.label}
            </text>
          ) : null,
        )}
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
          <div>
            <span className="font-semibold tabular-nums">{format(active.value)}</span>
            {/* The UNAMBIGUOUS label here — "Aug 3–9, 2026" — while the axis
                behind it carries the terse "8/3". */}
            <span className="ml-1.5 text-muted-foreground">
              {active.fullLabel ?? active.label}
            </span>
          </div>
          {/*
            The comparison row, and the DELTA — this is what turns a static
            readout into "how has it changed" (owner, 2026-08-25). Without it
            the overlay could be seen but not quantified, which is exactly the
            complaint about a chart that "doesnt show how it has changed
            compared to yesterday".
          */}
          {activeCmp ? (
            <div className="mt-0.5 flex items-center gap-1.5 border-t border-border/60 pt-0.5 text-[11px]">
              <span className="text-muted-foreground tabular-nums">{format(activeCmp.value)}</span>
              <span className="text-muted-foreground/70">{compareLabel ?? "prev"}</span>
              <DeltaText from={activeCmp.value} to={active.value} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A signed percentage change, or nothing.
 *
 * 🔴 Silent when the baseline is 0. A change from zero is not "+100%", it is
 * undefined — and printing any number there is the fabricated-statistic trap
 * this dashboard has a standing rule against. The absolute values are both on
 * screen beside it, so the reader loses nothing.
 */
function DeltaText({ from, to }: { from: number; to: number }) {
  if (from <= 0) return null;
  const pct = Math.round(((to - from) / from) * 100);
  if (pct === 0) return <span className="text-muted-foreground">±0%</span>;
  const up = pct > 0;
  return (
    <span className={cn("font-semibold tabular-nums", up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

/**
 * Search Console's granularity control: a tinted pill with a chevron, sitting
 * in the chart card's top-right.
 *
 * A native `<select>` under the styling, deliberately. It is one option wide at
 * rest (the reference's whole point — a segmented row has to show every option
 * always, which is what put a permanently greyed-out "Monthly" on screen), it
 * opens the platform picker on a phone, and it brings focus handling,
 * type-ahead and Escape without a line of menu code.
 */
function GranularityMenu({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string; disabled?: boolean }[];
  onChange: (id: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <span className="relative inline-flex items-center">
      <select
        aria-label="Group data by"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // `pr-6` leaves room for the chevron; `appearance-none` removes the
        // platform arrow so there is exactly one.
        className="appearance-none rounded-full bg-primary/10 py-1 pl-2.5 pr-6 text-[11px] font-bold text-primary outline-none transition hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-primary"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-1.5 h-3 w-3 text-primary"
      />
    </span>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE CHANGE FIGURE — LAST COMPLETE PERIOD vs THE ONE BEFORE IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-26: "i no longer see a percentage drops or increase in all the
 * charts, put a legit, accurate percentage and not fake percentage."
 *
 * Both halves of that are fair, and they came from two different mistakes of
 * mine. This is the third version, so the reasoning is written down properly.
 *
 * ── v1 was FAKE: last bucket vs FIRST bucket ──────────────────────────────
 * With no comparison series the chip compared the newest bucket against the
 * oldest one in the window. The oldest bucket is routinely a near-empty partial
 * day, so 3 visitors against 428 produced a true, useless "▲ 14167%".
 *
 * ── v2 was SILENT: I raised a minimum baseline ────────────────────────────
 * That suppressed the absurd numbers by suppressing almost every number. It
 * treated the symptom — the comparison itself was still the wrong one.
 *
 * ── v3, this one: compare two ADJACENT, COMPLETE periods ──────────────────
 * The granularity control already says what a "period" is, so the honest change
 * figure is the obvious one: yesterday against the day before, last week
 * against the week before, last month against the month before.
 *
 * 🔴 THE TRAILING BUCKET IS EXCLUDED, and this is the part that makes it
 * accurate rather than merely defensible. The final bucket is always the period
 * IN PROGRESS — today, this week, this month. Measuring a part-finished day
 * against a finished one manufactures a drop every single morning, which is
 * exactly the "fake percentage" being complained about, just with a smaller
 * number. So the comparison runs over the last two COMPLETE buckets and the
 * in-progress one is left out of it.
 *
 * Consequences, stated rather than hidden:
 *  • it needs three buckets (two complete plus the running one), so a very
 *    short series shows no chip — correct, there is no trend in two points;
 *  • the chip therefore describes the last CLOSED period, not this instant.
 *    `title` says so on hover, because a number whose meaning is guessed at is
 *    the same problem in a new outfit.
 *
 * A zero baseline still prints nothing: a change from nothing is undefined, not
 * "+100%", and this dashboard has a standing rule against numbers it cannot
 * stand behind. There is deliberately NO minimum-size threshold beyond that —
 * v2 proved that silencing real movement is its own kind of dishonesty, and the
 * absolute values sit right beside the chip for scale.
 */
/** "daily" -> "day". What one bucket represents, for the chip tooltip. */
function periodNoun(g?: string): string {
  return g === "weekly" ? "week" : g === "monthly" ? "month" : "day";
}

function TrendChip({
  points,
  compare,
  periodNoun = "period",
}: {
  points: AreaPoint[];
  compare?: AreaPoint[];
  /** "day" | "week" | "month" — what one bucket represents, for the tooltip. */
  periodNoun?: string;
}) {
  const sum = (a: AreaPoint[]) => a.reduce((n, p) => n + p.value, 0);

  let latest: number;
  let baseline: number;
  let explain: string;

  if (compare && compare.length > 0) {
    /*
      A real comparison series was supplied (the previous window, drawn as the
      dashed overlay). Then the headline figure is this period's TOTAL against
      that period's total — totals, not endpoints, so one quiet Sunday at the
      edge cannot invert the number for a whole month.
    */
    latest = sum(points);
    baseline = sum(compare);
    explain = "vs the previous period";
  } else {
    // Two adjacent COMPLETE buckets; the in-progress one is dropped.
    if (points.length < 3) return null;
    latest = points[points.length - 2]!.value;
    baseline = points[points.length - 3]!.value;
    explain = `last complete ${periodNoun} vs the ${periodNoun} before`;
  }

  if (baseline <= 0) return null;

  const trend = ((latest - baseline) / baseline) * 100;
  const trendUp = trend >= 0;
  return (
    <span
      className={cn(
        "cursor-help rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
        trendUp
          ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
          : "bg-rose-500/12 text-rose-600 dark:text-rose-400",
      )}
      title={explain}
    >
      {trendUp ? "▲" : "▼"} {Math.abs(trend).toFixed(trend > -10 && trend < 10 ? 1 : 0)}%
    </span>
  );
}

function TableView({ title, points, format }: { title: string; points: AreaPoint[]; format: (n: number) => string }) {
  return (
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
  );
}

/** Portaled, larger render of the same chart. Escape, backdrop click, or the
 *  close button all dismiss it; body scroll is locked while it's open. */
function ExpandedChart({
  title,
  subtitle,
  points,
  slot,
  format,
  onClose,
  compare,
  compareLabel,
  granularity,
}: {
  title: string;
  subtitle?: string;
  points: AreaPoint[];
  slot: 1 | 2 | 3 | 4;
  format: (n: number) => string;
  onClose: () => void;
  /* The expanded view is the SAME geometry at a bigger size — so it takes the
     comparison series too. A modal that quietly dropped the overlay would make
     "expand to look closer" the one place you cannot see the trend. */
  compare?: AreaPoint[];
  compareLabel?: string;
  /** Only for the trend chip's tooltip wording — the modal has no picker. */
  granularity?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title}, expanded`}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="viz-panel relative w-full max-w-4xl rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-7"
        data-slot={slot}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div className="mb-4 flex flex-wrap items-start justify-between gap-2 pr-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="viz-swatch h-3 w-3 shrink-0 rounded-sm" aria-hidden />
              <h4 className="truncate text-base font-bold">{title}</h4>
            </div>
            {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold tabular-nums tracking-tight">
              {format(points[points.length - 1]?.value ?? 0)}
            </span>
            <TrendChip points={points} compare={compare} periodNoun={periodNoun(granularity)} />
          </div>
        </div>

        <ChartSvg title={title} points={points} format={format} width={960} height={420} labelPx={12} compare={compare} compareLabel={compareLabel} />
      </div>
    </div>,
    document.body,
  );
}

export function AdminAreaChart({
  title,
  subtitle,
  points,
  /** 1-based slot in the categorical palette. Keyed to the MEASURE, not the order. */
  slot = 1,
  format = (n: number) => formatCompactNumber(n),
  className,
  compare,
  compareLabel = "prev. period",
  granularity,
  granularityOptions,
  onGranularityChange,
}: {
  title: string;
  subtitle?: string;
  points: AreaPoint[];
  slot?: 1 | 2 | 3 | 4;
  format?: (n: number) => string;
  className?: string;
  /**
   * The SAME window, one period earlier, already bucketed the same way — so
   * index `i` in both arrays is the same position within its own period.
   *
   * Drawn as Search Console draws it: a dashed, muted line on the SHARED y
   * scale, with no fill. Optional throughout — a panel with no prior data
   * simply omits it and the chart is exactly what it was.
   */
  compare?: AreaPoint[];
  /** What the comparison represents, for the tooltip ("prev. period"). */
  compareLabel?: string;
  /**
   * Search Console's in-card granularity dropdown ("Daily ⌄").
   *
   * Optional and inert unless BOTH the value and the handler are passed — the
   * ten other charts on this dashboard have no grouping of their own and must
   * not sprout a control that does nothing.
   */
  granularity?: string;
  granularityOptions?: { id: string; label: string; disabled?: boolean }[];
  onGranularityChange?: (id: string) => void;
}) {
  const [showTable, setShowTable] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
          <span className="text-lg font-bold tabular-nums tracking-tight">{format(points[points.length - 1]?.value ?? 0)}</span>
          <TrendChip points={points} compare={compare} periodNoun={periodNoun(granularity)} />
          {/*
            ── SEARCH CONSOLE PUTS THE GRANULARITY IN THE CHART CARD ──────────

            Owner, 2026-08-26, with a screenshot: "there are two period interval
            button and the chart is still not like the google chart".

            Right, and it was a LAYOUT mistake rather than a styling one. The
            toolbar carried `7d / 30d / 90d` and `Daily ⌄` side by side, which
            reads as two competing interval pickers because that is exactly what
            it looks like. Search Console never puts them together: the date
            RANGE sits at the top of the page, and the granularity dropdown sits
            inside the chart card, next to the data it regroups.

            Separating them in space is what removes the duplication — the same
            thing the reference does.

            Rendered only when the parent passes a handler, so the charts that
            have no granularity of their own are untouched.
          */}
          {granularity && onGranularityChange ? (
            <GranularityMenu
              value={granularity}
              options={granularityOptions ?? []}
              onChange={onGranularityChange}
            />
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={`Expand ${title} chart`}
            className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </figcaption>

      {/* Mouse convenience only — clicking the drawing also expands it. The
          Maximize2 button above is the accessible control; this stays a plain
          div (not nested inside it) so no interactive element ends up nested
          inside another. */}
      <div onClick={() => setExpanded(true)} className="cursor-zoom-in">
        <ChartSvg title={title} points={points} format={format} width={760} height={190} compare={compare} compareLabel={compareLabel} />
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
      {showTable ? <TableView title={title} points={points} format={format} /> : null}

      {expanded ? (
        <ExpandedChart
          title={title}
          subtitle={subtitle}
          points={points}
          slot={slot}
          format={format}
          onClose={() => setExpanded(false)}
          compare={compare}
          compareLabel={compareLabel}
          granularity={granularity}
        />
      ) : null}
    </figure>
  );
}

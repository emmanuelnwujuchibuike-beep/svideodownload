import type { LucideIcon } from "lucide-react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Shared Studio primitives (Feature 15 · Part 9).
 *
 * Server components by default — no "use client" here. Every one of these is a
 * pure render over data the page already fetched, so shipping them as client
 * components would send JavaScript to draw a number that never changes after
 * paint. Only the pieces that genuinely need interaction (the customiser, the
 * content manager, the calendar editor) are client components.
 *
 * ── The rule these all obey ─────────────────────────────────────────────
 * An absent measurement renders as an em-dash, never as zero. "0 views" and
 * "we have not measured your views" are different statements, and a dashboard
 * that confuses them teaches its reader to distrust it.
 */

export function StatCard({
  icon: Icon,
  label,
  value,
  delta,
  suffix,
  accent,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  /** null renders as an em-dash — not measured, as distinct from measured zero. */
  value: number | null;
  delta?: number;
  suffix?: string;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 shadow-soft transition sm:p-5",
        accent ? "border-primary/30 bg-primary/[0.03] ring-1 ring-primary/15" : "border-border/70 bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl",
            accent ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
          )}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        {delta !== undefined ? <DeltaChip delta={delta} /> : null}
      </div>
      <p className="mt-3.5 text-2xl font-bold tracking-tight tabular-nums">
        {value === null ? <span className="text-muted-foreground">&mdash;</span> : formatCompactNumber(value)}
        {value !== null && suffix ? <span className="text-base font-semibold text-muted-foreground">{suffix}</span> : null}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
      {hint ? <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/80">{hint}</p> : null}
    </div>
  );
}

/** A change against a real prior reading. Zero is shown as "no change" rather
 *  than a green +0, which reads as growth. */
export function DeltaChip({ delta, suffix = "" }: { delta: number; suffix?: string }) {
  const up = delta > 0;
  const flat = delta === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        flat
          ? "bg-secondary text-muted-foreground"
          : up
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {flat ? "No change" : `${up ? "+" : ""}${formatCompactNumber(delta)}${suffix}`}
    </span>
  );
}

export function StudioCard({
  title,
  icon: Icon,
  action,
  children,
  className,
  subtitle,
  id,
}: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  subtitle?: string;
  /** Anchor target, so a card can be linked to directly (e.g. `#health`). */
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {Icon ? <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
            {title}
          </h2>
          {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A progress ring. Pure SVG with a CSS transition rather than an animation
 * loop — it costs nothing after paint, and a reduced-motion viewer simply sees
 * it arrive at its final value.
 */
export function ProgressRing({
  progress,
  size = 64,
  label,
  tone = "primary",
}: {
  /** 0-1. */
  progress: number;
  size?: number;
  label?: string;
  tone?: "primary" | "emerald" | "amber" | "rose";
}) {
  const stroke = Math.max(4, Math.round(size / 12));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dash = circumference * clamped;

  const strokeClass = {
    primary: "stroke-primary",
    emerald: "stroke-emerald-500",
    amber: "stroke-amber-500",
    rose: "stroke-rose-500",
  }[tone];

  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="fill-none stroke-secondary" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={cn("fill-none transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none", strokeClass)}
        />
      </svg>
      {label ? (
        <span className="absolute text-xs font-bold tabular-nums" style={{ fontSize: Math.max(10, size / 5) }}>
          {label}
        </span>
      ) : null}
    </div>
  );
}

/** A labelled bar. `max` of 0 renders an empty track rather than dividing by
 *  zero into a full one. */
export function MeterRow({
  label,
  value,
  max,
  display,
  tone = "from-blue-600 to-cyan-400",
}: {
  label: string;
  value: number;
  max: number;
  display?: string;
  tone?: string;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{display ?? formatCompactNumber(value)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out motion-reduce:transition-none", tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** The one component every "we cannot measure this" case routes through, so
 *  the reason is always stated and never left to the reader to infer. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-center text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "primary" | "amber" | "emerald" | "rose" }) {
  const tones = {
    muted: "bg-secondary text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  }[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", tones)}>{children}</span>;
}

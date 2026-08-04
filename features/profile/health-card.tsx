import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { BAND_LABEL, type Band, type ProfileHealth } from "@/lib/profile/health";
import { cn } from "@/lib/utils";

/**
 * Profile Health Score™ — the ring (Feature 18 · Part 15).
 *
 * Server-rendered SVG: no client JavaScript, no charting library, no animation
 * loop. The ring is one stroked circle with a dash offset, which is why it can
 * live in the owner's rail without costing the profile page a single kilobyte
 * of bundle.
 *
 * The score is ALWAYS shown as a number as well as an arc, and the band is
 * spelled out in words — a ring alone is unreadable to a screen reader and
 * ambiguous to anyone who can't distinguish the colours.
 */

const BAND_COLOR: Record<Band, { from: string; to: string; text: string }> = {
  critical: { from: "#f43f5e", to: "#fb7185", text: "text-rose-500" },
  "needs-work": { from: "#f59e0b", to: "#fbbf24", text: "text-amber-500" },
  good: { from: "#0A84FF", to: "#38bdf8", text: "text-blue-500" },
  strong: { from: "#6C4DFF", to: "#a78bfa", text: "text-violet-500" },
  excellent: { from: "#10b981", to: "#34d399", text: "text-emerald-500" },
};

export function HealthRing({ score, band, size = 132 }: { score: number; band: Band; size?: number }) {
  const stroke = size >= 120 ? 10 : 8;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const colors = BAND_COLOR[band];
  const gradientId = `health-${band}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Profile health score ${score} out of 100 — ${BAND_LABEL[band]}`}
      className="shrink-0"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={colors.from} />
          <stop offset="100%" stopColor={colors.to} />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-secondary" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - score / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-foreground font-bold"
        style={{ fontSize: size * 0.28 }}
      >
        {score}
      </text>
    </svg>
  );
}

/**
 * The compact card for the owner's profile rail. Shows the score, the band and
 * the single most important thing to do next — not the whole list, because a
 * rail card that becomes a to-do list is one nobody reads twice.
 */
export function HealthCard({ health }: { health: ProfileHealth }) {
  const top = health.recommendations[0];
  const colors = BAND_COLOR[health.band];

  return (
    <section className="lux-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <ShieldCheck className="h-[18px] w-[18px] text-muted-foreground" /> Profile health
        </h2>
        <span className={cn("text-xs font-bold", colors.text)}>{BAND_LABEL[health.band]}</span>
      </div>

      <div className="flex items-center gap-4">
        <HealthRing score={health.score} band={health.band} size={92} />
        <div className="min-w-0 flex-1">
          {top ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Do this next</p>
              <p className="mt-1 text-sm font-semibold leading-snug">{top.title}</p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{top.detail}</p>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-500">
              <Check className="h-4 w-4" /> Nothing left to fix.
            </p>
          )}
        </div>
      </div>

      <Link
        href="/account/health"
        prefetch
        className="mt-4 flex items-center justify-between rounded-2xl bg-secondary/50 px-3.5 py-2.5 text-sm font-semibold transition hover:bg-secondary"
      >
        See the full checkup
        <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

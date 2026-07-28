import { ShieldCheck } from "lucide-react";

import type { Reputation } from "@/lib/social/reputation";
import { formatCompactNumber } from "@/lib/utils";

/**
 * Reputation™ card (owner rail). A premium, cartoon-free presentation of the
 * user's DERIVED reputation: a rank emblem inside a progress ring toward the next
 * rank, the point total, and the earned Trust Index. Pure server-rendered
 * SVG/CSS — no client JS, no animation loop — so it costs nothing at rest.
 *
 * Every number is computed from real signals (see lib/social/reputation.ts); the
 * card explains, in one honest line, what reputation is earned from and what's
 * still to come (points ledger, streaks, prestige).
 */
export function ReputationCard({ reputation }: { reputation: Reputation }) {
  const { score, trustIndex, rank, nextRank, progress, toNext } = reputation;

  const R = 44;
  const C = 2 * Math.PI * R;
  const dash = C * (1 - progress);
  const gradId = `rep-${rank.key}`;

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">Reputation</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Trust {trustIndex}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* Progress ring + rank emblem */}
        <div className="relative h-[92px] w-[92px] shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={rank.from} />
                <stop offset="100%" stopColor={rank.to} />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--border))" strokeWidth="7" opacity="0.5" />
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={dash}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-md ring-1 ring-inset ring-white/25"
              style={{ backgroundImage: `linear-gradient(135deg, ${rank.from}, ${rank.to})` }}
            >
              <ShieldCheck className="h-6 w-6" />
            </span>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-lg font-extrabold tracking-tight">{rank.name}</p>
          <p className="text-sm text-muted-foreground">{formatCompactNumber(score)} pts</p>
          {nextRank ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatCompactNumber(toNext)} to <span className="font-semibold text-foreground">{nextRank.name}</span>
            </p>
          ) : (
            <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">Legacy — the highest rank</p>
          )}
        </div>
      </div>

      {/* Trust Index bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
          <span>Trust Index</span>
          <span>{trustIndex}/100</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full"
            style={{ width: `${trustIndex}%`, backgroundImage: `linear-gradient(90deg, ${rank.from}, ${rank.to})` }}
          />
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Earned from account age, contributions, healthy engagement &amp; verification. Points ledger, streaks &amp;
        prestige coming soon.
      </p>
    </section>
  );
}

import { Crown, Download, Medal, Trophy, UserRound } from "lucide-react";

import type { TopDownloadersResult } from "@/lib/admin/top-downloaders";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Top downloaders — signed-in members ranked 1..10 by recent download volume, with
 * what they download most, shown as a chart + number + words (owner). Anonymous
 * downloads are never ranked; their volume is a footnote for context.
 *
 * Server component — the data is fetched server-side (lib/admin/top-downloaders.ts)
 * and this only renders it. Responsive: the bar chart and the labels reflow on
 * narrow widths.
 */

const RANK_STYLE: Record<number, { ring: string; badge: string; icon: typeof Trophy | null }> = {
  1: { ring: "ring-amber-400/60", badge: "bg-gradient-to-br from-amber-400 to-yellow-500 text-black", icon: Crown },
  2: { ring: "ring-slate-300/60", badge: "bg-gradient-to-br from-slate-300 to-slate-400 text-black", icon: Trophy },
  3: { ring: "ring-orange-400/60", badge: "bg-gradient-to-br from-orange-400 to-amber-600 text-black", icon: Medal },
};

export function TopDownloaders({ data }: { data: TopDownloadersResult }) {
  const { ranked, anonymousCount, sampled } = data;
  const max = ranked[0]?.count ?? 1;

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 text-violet-600 dark:text-violet-300">
          <Trophy className="h-4.5 w-4.5 h-[18px] w-[18px]" />
        </span>
        <h3 className="font-semibold">Top downloaders</h3>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Signed-in members ranked by recent download volume, and what they grab most.
        Anonymous downloads aren&rsquo;t ranked.
      </p>

      {ranked.length === 0 ? (
        <p className="rounded-2xl bg-secondary/30 p-4 text-sm text-muted-foreground">
          No signed-in downloads yet. As members download while logged in, the
          leaderboard fills here.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {ranked.map((d) => {
            const style = RANK_STYLE[d.rank];
            const pct = Math.max(6, Math.round((d.count / max) * 100));
            const Icon = style?.icon;
            return (
              <li
                key={d.rank}
                className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/20 p-2.5 sm:gap-4 sm:p-3"
              >
                {/* Rank badge (number + medal for the top 3) */}
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold tabular-nums ring-1",
                    style ? cn(style.badge, style.ring) : "bg-secondary text-muted-foreground ring-border",
                  )}
                >
                  {Icon ? <Icon className="h-4 w-4" /> : d.rank}
                </span>

                {/* Name + words + chart */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-semibold">{d.displayName}</span>
                      {d.handle ? <span className="hidden truncate text-xs text-muted-foreground sm:inline">@{d.handle}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-bold tabular-nums">
                      <Download className="h-3.5 w-3.5 text-blue-500" />
                      {formatCompactNumber(d.count)}
                    </span>
                  </div>

                  {/* The bar (chart) */}
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 via-violet-500 to-fuchsia-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Words — what they download most */}
                  {d.topPlatform || d.topFormat ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Mostly{" "}
                      <span className="font-medium text-foreground">
                        {[d.topPlatform, d.topFormat].filter(Boolean).join(" · ")}
                      </span>
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Anonymous context — never ranked, shown so the numbers add up honestly. */}
      {sampled > 0 || anonymousCount > 0 ? (
        <p className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          Ranked over {formatCompactNumber(sampled)} recent signed-in downloads ·{" "}
          <span className="font-medium">{formatCompactNumber(anonymousCount)}</span> anonymous
          downloads in this window (not ranked).
        </p>
      ) : null}
    </section>
  );
}

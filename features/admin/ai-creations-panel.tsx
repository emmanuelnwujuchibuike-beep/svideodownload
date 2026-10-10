import { AudioLines, Clapperboard, Trophy } from "lucide-react";

import { WEEKLY_MIN_SPEND, WEEKLY_PRIZES } from "@/lib/ai/weekly-top-rules";
import type { AiCreationsOverview } from "@/lib/ai/weekly-top";

/**
 * AI creations at a glance (owner, 2026-10-10: "put a slot in admin dashboard
 * so I can clearly see AI creation, audios and videos, and show top 10 creation
 * with details"). Server-rendered — no client JavaScript on the admin page.
 *
 *   · completed creations by kind, today / 7 days / 30 days
 *   · this week's top 10 creators by credits spent, with what they made
 *   · the weekly prizes: 50 / 30 / 20 credits for ranks 1–3, each only if that
 *     person spent more than 500 credits that week (lib/ai/weekly-top-rules.ts),
 *     paid automatically when the week closes, and last week's winners
 *   · the ten most recent creations
 */
export function AiCreationsPanel({ data, labels }: { data: AiCreationsOverview; labels: Record<string, string> }) {
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  return (
    <section className="space-y-5 rounded-2xl border border-border/70 bg-card p-4 shadow-sm" aria-labelledby="ai-creations-title">
      <h2 id="ai-creations-title" className="text-base font-bold">AI creations</h2>

      <div className="grid grid-cols-3 gap-2">
        {data.windows.map((w) => (
          <div key={w.label} className="rounded-xl bg-secondary/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{w.label}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold tabular-nums">
              <Clapperboard className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> {w.video.toLocaleString()} <span className="sr-only">videos</span>
            </p>
            <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
              <AudioLines className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> {w.audio.toLocaleString()} <span className="sr-only">audios</span>
            </p>
            {w.other ? <p className="text-[11px] text-muted-foreground tabular-nums">+{w.other} other</p> : null}
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Top 10 creators this week <span className="font-normal text-muted-foreground">(since {data.weekStart}, by credits spent)</span></h3>
        {data.topCreators.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI credits spent yet this week.</p>
        ) : (
          <ol className="divide-y divide-border/60 rounded-xl ring-1 ring-inset ring-border/60">
            {data.topCreators.map((c, i) => {
              const prize = i < WEEKLY_PRIZES.length ? WEEKLY_PRIZES[i]! : null;
              const onTrack = prize !== null && c.spent > WEEKLY_MIN_SPEND;
              return (
                <li key={c.userId} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="w-5 text-right text-sm font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                  {c.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="h-8 w-8 shrink-0 rounded-full bg-secondary" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{c.displayName ?? (c.handle ? `@${c.handle}` : c.userId.slice(0, 8))}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.handle ? `@${c.handle} · ` : ""}
                      {c.creations} made ({c.video} video, {c.audio} audio) · last {when(c.lastAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-bold tabular-nums">{c.spent.toLocaleString()}</span>
                    <span className="block text-[11px] text-muted-foreground">credits</span>
                    {prize !== null ? (
                      <span className={onTrack ? "block text-[11px] font-semibold text-emerald-600 dark:text-emerald-400" : "block text-[11px] text-muted-foreground"}>
                        {onTrack ? `+${prize} prize` : `needs >${WEEKLY_MIN_SPEND}`}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Prizes: {WEEKLY_PRIZES.join(" / ")} credits for ranks 1–3, each only if that creator spent more than {WEEKLY_MIN_SPEND} credits that week. Paid automatically when the week closes (Monday 00:00 UTC).
        </p>
      </div>

      {data.lastWeek ? (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Trophy className="h-4 w-4 text-amber-500" aria-hidden /> Paid for the week of {data.lastWeek.week}
          </h3>
          <ul className="space-y-1 text-sm">
            {data.lastWeek.winners.map((w) => (
              <li key={w.rank}>
                #{w.rank} {w.displayName ?? (w.handle ? `@${w.handle}` : "—")} — spent {w.spent.toLocaleString()}, received <b>{w.credits}</b> credits
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Most recent creations</h3>
        <ul className="space-y-1 text-sm">
          {data.recent.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                {r.kind === "audio" ? "Audio" : r.kind === "video" ? "Video" : "Other"} · {labels[r.feature] ?? r.feature}
                {r.handle ? <span className="text-muted-foreground"> · @{r.handle}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{when(r.createdAt)}</span>
            </li>
          ))}
          {data.recent.length === 0 ? <li className="text-muted-foreground">Nothing completed in the last 30 days.</li> : null}
        </ul>
      </div>
    </section>
  );
}

import { Star } from "lucide-react";
import Link from "next/link";

import { alertsEnabled } from "@/lib/notify";
import { getRatings } from "@/lib/social/ratings";
import { cn } from "@/lib/utils";

/**
 * App ratings — the admin panel (migration 0111).
 *
 * Server-rendered, no client JavaScript: it is a summary and a list.
 *
 * The empty state distinguishes "nobody has rated yet" from "the table isn't
 * there" on purpose. Those look identical on screen and have completely
 * different fixes, and an operator staring at a blank panel should not have to
 * guess which one they are looking at.
 */
export async function RatingsSection() {
  const { rows, total, average, distribution, unavailable } = await getRatings();
  // Answers "why haven't I had any rating emails?" without a log dive.
  const email = alertsEnabled();

  const emailNotice = email ? null : (
    <p className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/[0.06] px-3.5 py-3 text-xs leading-relaxed">
      <strong>Rating emails are switched off.</strong> They need <code className="font-mono">RESEND_API_KEY</code> and{" "}
      <code className="font-mono">ALERT_EMAIL_TO</code> (or <code className="font-mono">ADMIN_EMAILS</code>) set on the
      Vercel frontend. Until both are set, ratings still land in this panel but nothing is sent.
    </p>
  );

  if (unavailable) {
    return (
      <div className="space-y-3">
        {emailNotice}
        <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center">
          <p className="text-sm font-semibold">Ratings aren&apos;t available yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Migration <code className="font-mono">0111_app_ratings.sql</code> hasn&apos;t been applied, so nothing can
            be stored. Ratings left in the meantime are still emailed to you — that email is their only copy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {emailNotice}
      <div className="flex flex-wrap items-end gap-6 rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm">
        <div>
          <p className="text-3xl font-bold tabular-nums">{average ?? "—"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {total} rating{total === 1 ? "" : "s"}
          </p>
        </div>
        <div className="min-w-[200px] flex-1 space-y-1">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = distribution[star - 1] ?? 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={star} className="flex items-center gap-2">
                <span className="w-3 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {star}
                </span>
                <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                <span className="lux-progress h-1.5 flex-1">
                  <span className="lux-progress-bar block" style={{ width: `${pct}%` }} />
                </span>
                <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          Nobody has rated the app yet. The prompt appears after a member or guest completes two downloads.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-border/60 px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-0.5" aria-label={`${r.rating} out of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={cn("h-3.5 w-3.5", n <= r.rating ? "fill-amber-400 text-amber-400" : "text-border")}
                    />
                  ))}
                </span>
                <span className="text-sm font-semibold">
                  {r.handle ? (
                    <Link href={`/u/${r.handle}`} className="hover:underline">
                      {r.displayName || `@${r.handle}`}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Guest</span>
                  )}
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {new Date(r.createdAt).toLocaleDateString()} ·{" "}
                  {r.downloads != null ? `${r.downloads} download${r.downloads === 1 ? "" : "s"}` : "unknown downloads"}
                  {r.surface ? ` · ${r.surface}` : ""}
                </span>
              </div>
              {r.comment ? <p className="mt-1.5 text-sm leading-relaxed">{r.comment}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

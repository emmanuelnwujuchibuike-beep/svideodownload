"use client";

import {
  BadgeCheck,
  CalendarDays,
  Download,
  Flame,
  Loader2,
  ShieldAlert,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import type { DownloaderDetail } from "@/lib/admin/downloader-detail";
import { cn, formatCompactNumber, formatPostedOn } from "@/lib/utils";

import { Portal } from "@/components/ui/portal";

/**
 * Full detail behind one Top downloaders row — profile, streak, exact
 * lifetime count, day/week frequency, and their recent downloads.
 *
 * Owner, 2026-08-26: "signed in top downloader in live activity, should be
 * clickable to see full details of that users download, streaks, and how many
 * times a day or week and all information about that user."
 *
 * Loaded on demand (fetched only once opened) and code-split from the main
 * bundle by its caller — /admin is already at its weight ceiling (see
 * revenue-chart-search-console-2026-08-25), and every operator loads the
 * leaderboard while almost none open a detail sheet in a given visit.
 */
export function DownloaderDetailSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [data, setData] = useState<DownloaderDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    void fetch(`/api/admin/top-downloaders/${userId}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: DownloaderDetail) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portalled — the admin shell's own chrome carries a transform/blur in
  // places (see components/ui/portal.tsx for why that clips a fixed overlay).
  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Downloader details"
        className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border border-border bg-card shadow-2xl sm:max-w-lg sm:rounded-3xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-card/95 px-5 py-4 backdrop-blur">
            <h2 className="text-base font-bold">Downloader details</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5">
            {error ? (
              <p className="rounded-2xl bg-secondary/30 p-4 text-sm text-muted-foreground">
                Couldn&rsquo;t load this member&rsquo;s details.
              </p>
            ) : !data ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              </div>
            ) : (
              <DetailBody data={data} />
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

function DetailBody({ data }: { data: DownloaderDetail }) {
  const { profile, streak } = data;
  return (
    <div className="space-y-6">
      {/* Identity */}
      <div className="flex items-center gap-3">
        {profile.avatarUrl ? (
          <Image src={profile.avatarUrl} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-border" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white">
            {profile.displayName.charAt(0).toUpperCase() || <UserRound className="h-6 w-6" />}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-base font-bold">{profile.displayName}</span>
            {profile.isVerified ? <BadgeCheck className="h-4 w-4 shrink-0 text-blue-500" aria-label="Verified" /> : null}
          </div>
          {profile.handle ? <p className="truncate text-sm text-muted-foreground">@{profile.handle}</p> : null}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold capitalize text-foreground">
              {profile.plan}
            </span>
            {profile.isSuspended ? (
              <span className="flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 font-semibold text-rose-600 dark:text-rose-400">
                <ShieldAlert className="h-3 w-3" /> Suspended
              </span>
            ) : null}
            {profile.joinedAt ? (
              <span className="text-muted-foreground">Joined {formatPostedOn(profile.joinedAt)}</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Download volume */}
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Today" value={data.today} />
        <Stat label="7 days" value={data.last7} />
        <Stat label="30 days" value={data.last30} />
        <Stat label="All-time" value={data.totalDownloads} accent />
      </div>
      <p className="-mt-4 text-[11px] text-muted-foreground">
        Averages {data.avgPerActiveDay.toFixed(1)} download{data.avgPerActiveDay === 1 ? "" : "s"} on a day they
        download at all.
        {data.scanCapped ? " Frequency figures below cover their most recent activity." : ""}
      </p>

      {/* Streak */}
      <section className="rounded-2xl border border-border/60 bg-secondary/20 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Flame className="h-4 w-4 text-orange-500" /> Streak
        </h3>
        {streak ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-extrabold tabular-nums">{streak.current}</p>
              <p className="text-[11px] text-muted-foreground">Current</p>
            </div>
            <div>
              <p className="text-lg font-extrabold tabular-nums">{streak.longest}</p>
              <p className="text-[11px] text-muted-foreground">Longest</p>
            </div>
            <div>
              <p className="text-lg font-extrabold tabular-nums">{streak.totalActiveDays}</p>
              <p className="text-[11px] text-muted-foreground">Active days</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No streak on record.</p>
        )}
      </section>

      {/* Daily frequency — last 30 days */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <CalendarDays className="h-4 w-4 text-violet-500" /> Downloads per day (last 30 days)
        </h3>
        <FrequencyBars days={data.dailyFrequency} />
      </section>

      {/* What they download */}
      {data.byPlatform.length > 0 || data.byFormat.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          {data.byPlatform.length > 0 ? <Breakdown title="Platforms" rows={data.byPlatform.map((p) => ({ label: p.platform, count: p.count }))} /> : null}
          {data.byFormat.length > 0 ? <Breakdown title="Formats" rows={data.byFormat.map((f) => ({ label: f.format, count: f.count }))} /> : null}
        </div>
      ) : null}

      {/* Recent downloads */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Download className="h-4 w-4 text-blue-500" /> Recent downloads
        </h3>
        {data.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No downloads on record.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-secondary/20 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{r.title || r.sourceUrl}</p>
                  <p className="text-muted-foreground">
                    {r.platform}
                    {r.format ? ` · ${r.format}` : ""} · {formatPostedOn(r.createdAt)}
                  </p>
                </div>
                <StatusPill status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={cn("rounded-2xl p-2.5 text-center", accent ? "bg-gradient-to-br from-blue-500/12 to-violet-500/12" : "bg-secondary/30")}>
      <p className={cn("text-base font-extrabold tabular-nums", accent && "bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent")}>
        {formatCompactNumber(value)}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * A single-series bar chart — no legend needed (one series; the heading names
 * it), no categorical palette (magnitude only). Reuses the same blue→violet
 * gradient the leaderboard's own row bars already use, so this reads as the
 * same visual language rather than a second chart style.
 *
 * Rounded 2px data-ends, 2px gaps between bars, native `title` for the
 * per-bar hover value (a proper tooltip is more than this small inline
 * sparkline needs), and two direct labels (first/last day) rather than one
 * per bar.
 */
function FrequencyBars({ days }: { days: DownloaderDetail["dailyFrequency"] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div>
      <div className="flex h-16 items-end gap-[2px]" role="img" aria-label={`Downloads per day over the last ${days.length} days`}>
        {days.map((d) => {
          const pct = Math.max(d.count > 0 ? 6 : 2, Math.round((d.count / max) * 100));
          return (
            <div
              key={d.date}
              title={`${new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${d.count}`}
              className={cn("min-w-[3px] flex-1 rounded-t-sm", d.count > 0 ? "bg-gradient-to-t from-blue-500 to-violet-500" : "bg-secondary")}
              style={{ height: `${pct}%` }}
            />
          );
        })}
      </div>
      {days.length > 0 ? (
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{new Date(days[0]!.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          <span>{new Date(days[days.length - 1]!.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        </div>
      ) : null}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = rows[0]?.count ?? 1;
  return (
    <div>
      <h4 className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <Sparkles className="h-3 w-3" /> {title}
      </h4>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="text-[11px]">
            <div className="flex items-center justify-between">
              <span className="truncate font-medium">{r.label}</span>
              <span className="tabular-nums text-muted-foreground">{r.count}</span>
            </div>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
                style={{ width: `${Math.max(6, Math.round((r.count / max) * 100))}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  cancelled: "bg-secondary text-muted-foreground",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", STATUS_STYLE[status] ?? "bg-secondary text-muted-foreground")}>
      {status}
    </span>
  );
}

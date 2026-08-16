"use client";

import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileDown,
  Loader2,
  Slash,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { DownloadLog, DownloadLogRow } from "@/lib/analytics/download-log";
import type { Range } from "@/lib/analytics/queries";
import { cn } from "@/lib/utils";

/**
 * Every user's download history — successful and failed — with the details and
 * the source link (owner, 2026-08-09).
 *
 * ── What an operator is actually here to do ──────────────────────────────────
 * Two jobs, and the table is built around them rather than around the columns
 * that happened to be available:
 *
 *   1. "A member says their download failed" — filter to Failed, find their
 *      download, read the real error reason and open the link to reproduce it.
 *   2. "Which platform is breaking?" — scan the failure reasons down the page.
 *
 * So the failure reason is a first-class column rather than a tooltip, and the
 * source URL is a real anchor: the whole point of the owner's ask is being able
 * to open the thing that failed.
 *
 * ── Honest about what it does not know ───────────────────────────────────────
 * A download recorded before the source URL started being sent shows "not
 * recorded", never a dead link or a reconstructed guess. Guests show as
 * "Guest · <short visitor id>" rather than being blanked — most of this site's
 * traffic is signed out, and hiding it would make the log look empty.
 */

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "completed", label: "Successful" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "requested", label: "Abandoned" },
];

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return "—";
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_STYLE: Record<string, { cls: string; Icon: typeof Check; label: string }> = {
  completed: { cls: "bg-emerald-500/12 text-emerald-600 ring-emerald-500/20 dark:text-emerald-300", Icon: Check, label: "Success" },
  failed: { cls: "bg-rose-500/12 text-rose-600 ring-rose-500/20 dark:text-rose-300", Icon: X, label: "Failed" },
  cancelled: { cls: "bg-amber-500/12 text-amber-600 ring-amber-500/20 dark:text-amber-300", Icon: Slash, label: "Cancelled" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? {
    cls: "bg-secondary text-muted-foreground ring-border/40",
    Icon: Loader2,
    // requested / started / preparing all mean the same thing once they are
    // sitting in a historical log: the download never reached an end state.
    label: "Abandoned",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset", s.cls)}>
      <s.Icon className="h-3 w-3" /> {s.label}
    </span>
  );
}

export function DownloadLogTable({ range }: { range: Range }) {
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<DownloadLog | null>(null);
  const [loading, setLoading] = useState(true);

  // Any filter change restarts paging — page 3 of "all" is not page 3 of "failed".
  useEffect(() => setPage(0), [status, range]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ range, status, page: String(page) });
    fetch(`/api/admin/downloads?${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DownloadLog | null) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, status, page]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3.5 py-2.5">
        <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <FileDown className="h-3.5 w-3.5" /> Download history — all users
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        </h4>
        <div className="inline-flex flex-wrap rounded-xl bg-secondary/60 p-1 ring-1 ring-inset ring-border/40">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              aria-pressed={status === t.key}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition active:scale-[0.96]",
                status === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {data && !data.available ? (
        <p className="flex items-center gap-2 px-3.5 py-6 text-xs text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Run migration <code className="rounded bg-secondary px-1">0115_analytics_integrity</code> — the download log
          reads an RPC that does not exist yet.
        </p>
      ) : data && data.rows.length === 0 ? (
        <p className="px-3.5 py-8 text-center text-xs text-muted-foreground">
          No downloads in this range{status !== "all" ? " with that status" : ""}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] text-left text-xs">
            <thead className="bg-secondary/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-bold">When</th>
                <th className="px-3 py-2 font-bold">Status</th>
                <th className="px-3 py-2 font-bold">Who</th>
                <th className="px-3 py-2 font-bold">Source</th>
                <th className="px-3 py-2 font-bold">Platform</th>
                <th className="px-3 py-2 font-bold">Quality</th>
                <th className="px-3 py-2 font-bold">Size</th>
                <th className="px-3 py-2 font-bold">Took</th>
                <th className="px-3 py-2 font-bold">Reason / where</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <Row key={r.downloadId} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.available && (data.rows.length > 0 || page > 0) ? (
        <div className="flex items-center justify-between border-t border-border/60 px-3.5 py-2">
          <span className="text-[11px] text-muted-foreground">Page {page + 1}</span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-xs font-semibold transition hover:bg-secondary disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <button
              type="button"
              disabled={!data.hasMore}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-xs font-semibold transition hover:bg-secondary disabled:opacity-40"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ r }: { r: DownloadLogRow }) {
  const when = new Date(r.createdAt);
  return (
    <tr className="border-t border-border/40 align-top transition hover:bg-secondary/40">
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
        {when.toLocaleDateString()} <span className="opacity-70">{when.toLocaleTimeString()}</span>
      </td>
      <td className="px-3 py-2">
        <StatusPill status={r.status} />
      </td>
      <td className="px-3 py-2">
        {r.userLabel ? (
          <span className="font-semibold">{r.userLabel}</span>
        ) : (
          // Guests are the majority here — shown, not hidden, with the anonymous
          // device id truncated so one visitor's downloads can still be grouped.
          // The ×N badges sit ON TOP of that same id (owner, 2026-08-16: the
          // repeat-download count belongs on the guest id it's counting, not in
          // a separate list computed against a different query) — `guestToday`/
          // `guestWeek` come from the same visitor_id this row already shows.
          <div className="flex flex-col gap-0.5">
            {(r.guestToday && r.guestToday > 1) || (r.guestWeek && r.guestWeek > 1) ? (
              <span className="flex flex-wrap items-center gap-1">
                {r.guestToday && r.guestToday > 1 ? (
                  <span className="rounded-full bg-fuchsia-500/12 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-fuchsia-600 dark:text-fuchsia-400">
                    ×{r.guestToday} today
                  </span>
                ) : null}
                {r.guestWeek && r.guestWeek > 1 ? (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                    ×{r.guestWeek} this week
                  </span>
                ) : null}
              </span>
            ) : null}
            <span className="text-muted-foreground">Guest · {r.visitorId.slice(0, 8)}</span>
          </div>
        )}
      </td>
      <td className="max-w-[18rem] px-3 py-2">
        {r.sourceUrl ? (
          <a
            href={r.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={r.sourceUrl}
            className="inline-flex max-w-full items-center gap-1 font-medium text-primary hover:underline"
          >
            <span className="truncate">{r.title || r.sourceUrl}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          <span className="text-muted-foreground">not recorded</span>
        )}
      </td>
      <td className="px-3 py-2 capitalize">{r.platform ?? "—"}</td>
      <td className="px-3 py-2">{r.quality ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtBytes(r.fileSize)}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDuration(r.durationMs)}</td>
      <td className="max-w-[16rem] px-3 py-2">
        {r.errorReason ? (
          <span className="text-rose-600 dark:text-rose-400" title={r.errorReason}>
            {r.errorReason}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {[r.country, r.device].filter(Boolean).join(" · ") || "—"}
          </span>
        )}
      </td>
    </tr>
  );
}

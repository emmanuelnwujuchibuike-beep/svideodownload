import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { notifyAdminsOfDownloadOutcome } from "@/lib/analytics/download-failure-alert";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sweeps `analytics_downloads` for rows that never reached a real outcome, and
 * alerts the admin (owner, 2026-08-16: "…and abandoned Downloads").
 *
 * ── Why this had to be built, not just wired up ─────────────────────────────
 * `analytics_downloads.status` and the `DownloadStatus` type both DECLARE
 * `timed_out`/`expired` as intended terminal states (see the column's own
 * comment: "requested → started → preparing → completed | failed | cancelled
 * | timed_out | expired"), but nothing in the codebase ever wrote either one —
 * `STATUS_FROM_TYPE` in the collect route maps only the six statuses a client
 * event can report, and an abandoned download by definition never sends a
 * closing event: the visitor just closed the tab, lost the connection, or
 * walked away. There was no hook to wire this into because the thing being
 * asked for — noticing a download that went SILENT — cannot be produced by
 * any client event; it can only be produced by comparing a row's age against
 * the clock, which is what a sweep is for.
 *
 * ── The threshold ────────────────────────────────────────────────────────
 * 30 minutes. `preparing` genuinely takes a while for a large file (the
 * client's own `SLOW_PREPARE_MS` warns the visitor about this rather than
 * treating it as stuck), so the bar has to be well past "slow" and into
 * "nothing has moved in a long time" before this calls it abandoned — a
 * download that is merely large should complete or fail on its own long
 * before 30 minutes elapse.
 *
 * Same auth pattern as this project's other cron routes (`CRON_SECRET` bearer
 * or an admin session). NOT registered in vercel.json: this project is on a
 * plan with a 2-cron limit and both slots are already spent (`trending`,
 * `profile-snapshots` — see push-log-cleanup/route.ts for the same situation
 * and the same note). Trigger it manually, from an external scheduler hitting
 * this URL with the bearer secret, or register it in place of one of the two
 * existing crons if this matters more than they do.
 */
const ABANDONED_AFTER_MINUTES = 30;
/** One run's ceiling — a sweep that has fallen behind catches up over several
 *  runs rather than alerting on thousands of rows in one burst. */
const BATCH_LIMIT = 200;

async function authorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return !!(await getAdminUser());
}

interface StuckRow {
  download_id: string;
  visitor_id: string;
  user_id: string | null;
  platform: string | null;
  media_kind: string | null;
  device: string | null;
  country: string | null;
}

async function run(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cutoff = new Date(Date.now() - ABANDONED_AFTER_MINUTES * 60_000).toISOString();
  const db = createAdminClient();

  const { data, error } = await db
    .from("analytics_downloads")
    .select("download_id, visitor_id, user_id, platform, media_kind, device, country")
    .in("status", ["requested", "started", "preparing"])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);
  // The table may not be migrated on every environment yet — that is a
  // "nothing to sweep" state here, not a failure.
  if (error) return NextResponse.json({ ok: true, swept: 0, note: "analytics_downloads unavailable" });

  const rows = (data ?? []) as StuckRow[];
  if (rows.length === 0) return NextResponse.json({ ok: true, swept: 0 });

  const ids = rows.map((r) => r.download_id);
  /*
    Marked BEFORE alerting, not after. The alert's own dedupe (`admin_alerts`,
    keyed on download+outcome) already stops a double email — this ordering is
    about the SWEEP, not the alert: if the process were interrupted between
    marking and alerting, a retried sweep would find these rows already
    `timed_out` and skip them (they no longer match the `.in(status, [...])`
    filter above), rather than re-selecting the same batch forever.
  */
  const { error: updateError } = await db.from("analytics_downloads").update({ status: "timed_out" }).in("download_id", ids);
  if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });

  await Promise.all(
    rows.map((r) =>
      notifyAdminsOfDownloadOutcome({
        downloadId: r.download_id,
        status: "timed_out",
        platform: r.platform,
        mediaKind: r.media_kind,
        errorReason: null,
        userId: r.user_id,
        visitorId: r.visitor_id,
        device: r.device,
        country: r.country,
      }).catch(() => {}),
    ),
  );

  return NextResponse.json({ ok: true, swept: rows.length });
}

export const GET = run;
export const POST = run;

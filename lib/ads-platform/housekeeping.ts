import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { alertEmailHtml, sendAdminAlertOnce } from "@/lib/notify";
import { SITE_URL } from "@/lib/site";

import { notifyAdvertiser, notifySlotOpen } from "./ad-notify";
import { PUBLIC_BUCKET, STAGING_BUCKET } from "./advertiser-server";
import { reconcilePendingAdPayments } from "./payment-server";

/**
 * Part 8 — the hourly ad housekeeping (app/api/cron/ad-housekeeping, clocked by
 * GitHub Actions like every other unregistered cron here). Every step is
 * bounded, idempotent, and independent: one failing never stops the others.
 *
 *   1. retention    ad_traffic_housekeeping(): ingest counters, raw events
 *                   past raw_retention_days, the per-day network hash past
 *                   ip_hash_retention_days, old resolved flags
 *   2. rescan       ad_rescan_blocked_destinations(): a domain blocked since
 *                   the last run stops serving
 *   3. assets       replaced or removed creatives' public files after 30
 *                   days. A path is creative-unique, so no live ad can share
 *                   one. Abandoned staged replacements (never an active
 *                   creative) after a day.
 *   4. alerts       open high and medium flags not yet alerted → ONE deduped
 *                   admin email per run (sendAdminAlertOnce). A decision
 *                   never waits on this: flags already act in the database.
 *   5. views        (0240) every views campaign at its deadline is fulfilled,
 *                   extended free or closed short (the serving route does the
 *                   same on a CDN miss; this covers quiet hours), then each
 *                   delivery change is told to its advertiser ONCE (claimed in
 *                   the database before it is sent).
 */

type Db = SupabaseClient;
const DAY = 86_400_000;

export async function runAdHousekeeping(db: Db, now: number = Date.now()) {
  const out: Record<string, unknown> = {};

  const hk = await db.rpc("ad_traffic_housekeeping");
  out.retention = hk.error ? { error: hk.error.message } : hk.data;

  const scan = await db.rpc("ad_rescan_blocked_destinations");
  out.rescan = scan.error ? { error: scan.error.message } : scan.data;

  out.assets = await cleanAssets(db, now).catch((e: unknown) => ({ error: String(e).slice(0, 160) }));
  out.alerts = await alertOpenFlags(db).catch((e: unknown) => ({ error: String(e).slice(0, 160) }));
  // 2026-10-09: a paid checkout whose webhook never arrived is confirmed with the provider here too
  out.payments = await reconcilePendingAdPayments(db, now).catch((e: unknown) => ({ error: String(e).slice(0, 160) }));
  out.views = await runViewsDelivery(db).catch((e: unknown) => ({ error: String(e).slice(0, 160) }));
  out.slots = await runSlotAlerts(db).catch((e: unknown) => ({ error: String(e).slice(0, 160) }));
  return out;
}

/** 0240: deadlines, then one notice per delivery change (claimed before it is sent, so never twice). */
async function runViewsDelivery(db: Db) {
  const deadlines = await db.rpc("ad_views_deadlines");
  // before 0240 runs the function is missing: nothing to do
  if (deadlines.error) return { skipped: deadlines.error.code === "PGRST202" ? "needs_0240" : deadlines.error.message };
  const claimed = await db.rpc("ad_views_claim_notices", { p_limit: 50 });
  const rows = (claimed.data ?? []) as { campaign_id: string; phase: string; target_views: number; delivered_views: number; shortfall_views: number | null; end_at: string | null; refund_owed: boolean }[];
  for (const r of rows) {
    if (r.phase === "fulfilled") await notifyAdvertiser(db, r.campaign_id, { kind: "target_reached", views: r.target_views });
    else if (r.phase === "extended") await notifyAdvertiser(db, r.campaign_id, { kind: "delivery_extended", remaining: Math.max(0, r.target_views - r.delivered_views), endAt: r.end_at });
    else if (r.phase === "review") await notifyAdvertiser(db, r.campaign_id, { kind: "delivery_review", remaining: Math.max(0, r.target_views - r.delivered_views) });
    else if (r.phase === "shortfall") await notifyAdvertiser(db, r.campaign_id, { kind: "delivery_shortfall", shortfall: r.shortfall_views ?? Math.max(0, r.target_views - r.delivered_views), refundOwed: r.refund_owed });
  }
  // 0241: one "planned period ends soon" notice, a day ahead, for a campaign still short
  const soon = await db.rpc("ad_views_deadline_notices", { p_hours: 24 });
  const soonRows = (soon.error ? [] : (soon.data ?? [])) as { campaign_id: string; remaining: number; end_at: string | null; free_extension: boolean }[];
  for (const r of soonRows) await notifyAdvertiser(db, r.campaign_id, { kind: "deadline_soon", remaining: r.remaining, endAt: r.end_at, freeExtension: r.free_extension });
  return { deadlines: deadlines.data, notices: rows.length, deadlineSoon: soonRows.length };
}

/** 0241 (owner 2026-10-12): members waiting for a full placement are told by push AND email when a slot opens — once. */
async function runSlotAlerts(db: Db) {
  const due = await db.rpc("ad_slot_waitlist_due", { p_limit: 100 });
  if (due.error) return { skipped: due.error.code === "PGRST202" ? "needs_0241" : due.error.message };
  const rows = (due.data ?? []) as { user_id: string; placement_name: string }[];
  for (const r of rows) await notifySlotOpen(db, r.user_id, r.placement_name);
  // owner 2026-10-12: a live fixed-period ad is told about a day before it ends (once per end date)
  const ending = await db.rpc("ad_expiring_notices", { p_hours: 24 });
  const endingRows = (ending.error ? [] : (ending.data ?? [])) as { campaign_id: string; end_at: string | null }[];
  for (const r of endingRows) await notifyAdvertiser(db, r.campaign_id, { kind: "expiring_soon", endAt: r.end_at });
  return { told: rows.length, endingSoon: endingRows.length };
}

async function cleanAssets(db: Db, now: number) {
  const removedBefore = new Date(now - 30 * DAY).toISOString();
  const { data: removed } = await db
    .from("ad_creatives")
    .select("id, storage_path")
    .eq("status", "removed")
    .not("storage_path", "is", null)
    .lt("updated_at", removedBefore)
    .limit(50);
  const rows = (removed ?? []) as { id: string; storage_path: string }[];
  if (rows.length) {
    const paths = rows.flatMap((r) => {
      const base = r.storage_path.replace(/\.[a-z0-9]+$/, "");
      // the worker's 480p file and its JPEG cover go with the creative (2026-10-12: nothing kept twice)
      return [r.storage_path, `${base}-poster.webp`, `${base}-480.mp4`, `${base}-480.jpg`];
    });
    await db.storage.from(PUBLIC_BUCKET).remove(paths);
    await db.storage.from(STAGING_BUCKET).remove(paths.flatMap((p) => [p, `${p}.checked`]));
    await db.from("ad_creatives").update({ storage_path: null }).in("id", rows.map((r) => r.id));
  }

  const { data: staged } = await db
    .from("ad_creatives")
    .select("id, storage_path")
    // staged replacements only: an ACTIVE pending creative may belong to a paid campaign waiting on a person
    .eq("status", "staged")
    .eq("validation_status", "pending")
    .not("storage_path", "is", null)
    .lt("created_at", new Date(now - DAY).toISOString())
    .limit(50);
  const abandoned = (staged ?? []) as { id: string; storage_path: string }[];
  if (abandoned.length) {
    await db.storage.from(STAGING_BUCKET).remove(abandoned.flatMap((r) => [r.storage_path, `${r.storage_path}.checked`, r.storage_path.replace(/\.[a-z0-9]+$/, "-poster.webp")]));
    await db.from("ad_creatives").update({ status: "removed" }).in("id", abandoned.map((r) => r.id));
  }
  return { removedFiles: rows.length, abandonedUploads: abandoned.length };
}

async function alertOpenFlags(db: Db) {
  const { data } = await db
    .from("ad_risk_flags")
    .select("id, kind, severity, hits, day, ad_campaigns(name)")
    .eq("status", "open")
    .is("alerted_at", null)
    .in("severity", ["high", "medium"])
    .order("id", { ascending: true })
    .limit(50);
  const flags = (data ?? []) as unknown as { id: number; kind: string; severity: string; hits: number; day: string; ad_campaigns: { name: string } | null }[];
  if (!flags.length) return { sent: 0 };
  const top = flags[flags.length - 1]!.id;
  const outcome = await sendAdminAlertOnce(
    `ad-risk-flags:${top}`,
    "ad_risk",
    `Ads: ${flags.length} flag${flags.length === 1 ? "" : "s"} to review`,
    alertEmailHtml({
      heading: "Ad traffic & safety flags",
      intro: "Filtered events already don't count and unsafe links are already paused. These need a decision.",
      rows: flags.slice(0, 20).map((f) => ({ label: `${f.severity.toUpperCase()} · ${f.kind.replace(/_/g, " ")}`, value: `${f.ad_campaigns?.name ?? "advertiser"} · ${f.day} · ${f.hits}×` })),
      footnote: `Review in Admin → Ads → Traffic & safety: ${SITE_URL}/admin`,
    }),
  );
  if (outcome === "sent" || outcome === "duplicate") {
    await db.from("ad_risk_flags").update({ alerted_at: new Date().toISOString() }).in("id", flags.map((f) => f.id));
  }
  return { flags: flags.length, outcome };
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { alertEmailHtml, sendAdminAlertOnce } from "@/lib/notify";
import { SITE_URL } from "@/lib/site";

import { PUBLIC_BUCKET, STAGING_BUCKET } from "./advertiser-server";

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
  return out;
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
    const paths = rows.flatMap((r) => [r.storage_path, r.storage_path.replace(/\.[a-z0-9]+$/, "-poster.webp")]);
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

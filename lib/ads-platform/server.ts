import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { cdnBucket } from "@/lib/net/cdn-bucket";

import type { CampaignStatus } from "./catalog";
import { checkDestinationUrl, validateCreative, type CreativeLimits } from "./creative-validation";
import type { ServingSnapshot } from "./eligibility";
import { buildServingPayload, type ServingPayload } from "./serving-payload";
import { baseDomain, chaseRedirects, destinationHeuristics, reputationLookup } from "./url-safety";

/**
 * Server side of the ad platform. Every write that matters is a database
 * function from 0195 (price, payment, activation, slot, status) — this file
 * only orders the calls and runs the creative checks whose verdict the
 * function then trusts. Callers pass the SERVICE-ROLE client: none of these
 * functions is executable by the browser.
 */

type Db = SupabaseClient;
type Rpc = { ok: boolean; reason?: string; [k: string]: unknown };

/* ─────────────────────────────── serving ─────────────────────────────── */

/** settings key: { [slotId]: ("frenzsave" | "network")[] } — who may occupy each physical slot, in order. */
export const AD_SLOT_PROVIDER_ORDER_KEY = "ad_slot_provider_order";

function parseProviderOrder(v: unknown): Record<string, string[]> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string[]> = {};
  for (const [slot, list] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(list)) out[slot] = list.filter((p): p is string => p === "frenzsave" || p === "network");
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Build the serving payload. Runs on a CDN miss only — at most once per
 * 5-minute bucket per edge region, however many visitors there are.
 *
 * The lifecycle sync (expire/start + prune) rides on the same miss, so status
 * and the audit stay honest with no cron and no idle cost. Serving never
 * depends on it: the engine filters on time either way.
 */
export async function loadServingPayload(db: Db, now: number = Date.now()): Promise<ServingPayload> {
  const sync = await db.rpc("ad_campaigns_sync_lifecycle");
  if (sync.error) console.warn("[ads-platform] lifecycle sync failed", { error: sync.error.message });
  const [{ data, error }, orderRow] = await Promise.all([
    db.rpc("ad_serving_snapshot"),
    // Part 5: the admin's provider order per physical slot — optional; a read error serves the defaults
    db.from("settings").select("value").eq("key", AD_SLOT_PROVIDER_ORDER_KEY).maybeSingle(),
  ]);
  if (error) throw new Error(`ad_serving_snapshot: ${error.message}`);
  return buildServingPayload(data as ServingSnapshot, cdnBucket(now), now, parseProviderOrder(orderRow.data?.value));
}

/**
 * Is any self-serve campaign live? Feeds the CDN-cached ad inventory, so a
 * page requests /api/ads/self only when there is something to show. Fails
 * CLOSED (false) — including before 0195 is applied, when the tables do not
 * exist: `.select("id").limit(1)` surfaces that as an error, where a head
 * count would have answered error:null.
 */
export async function anyCampaignLive(db: Db, now: number = Date.now()): Promise<boolean> {
  const [settings, live] = await Promise.all([
    db.from("ad_platform_settings").select("ads_enabled").limit(1),
    db.from("ad_campaigns").select("id").eq("status", "active").gt("end_at", new Date(now).toISOString()).limit(1),
  ]);
  if (settings.error || live.error) return false;
  return settings.data?.[0]?.ads_enabled === true && (live.data?.length ?? 0) > 0;
}

/* ───────────────────────────── validation ───────────────────────────── */

interface CreativeRow {
  id: string;
  format_code: string;
  media_type: string;
  mime_type: string | null;
  duration_seconds: number | string | null;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  destination_url: string | null;
  headline: string | null;
  description: string | null;
  validation_status: string;
  url_approved_url?: string | null;
}

export interface FormatRow {
  code: string;
  media_types: string[];
  max_duration_seconds: number | null;
  max_file_bytes: number;
  max_width: number;
  max_height: number;
  min_width: number | null;
  min_height: number | null;
  aspect_ratio: number | string | null;
  aspect_tolerance: number | string | null;
}

/**
 * Check every active creative of a campaign against the CURRENT format row
 * and write the verdict. A creative an admin marked `blocked` stays blocked —
 * an automated pass never overturns a human decision.
 */
export async function validateCampaignCreatives(db: Db, campaignId: string): Promise<{ valid: number; invalid: number }> {
  const { data: rows, error } = await db
    .from("ad_creatives")
    .select("id, format_code, media_type, mime_type, duration_seconds, file_size_bytes, width, height, destination_url, headline, description, validation_status, url_approved_url")
    .eq("campaign_id", campaignId)
    .eq("status", "active");
  if (error) throw new Error(`ad_creatives: ${error.message}`);
  const creatives = (rows ?? []) as CreativeRow[];
  const codes = [...new Set(creatives.map((c) => c.format_code))];
  const { data: fmts, error: fErr } = codes.length
    ? await db.from("ad_formats").select("code, media_types, max_duration_seconds, max_file_bytes, max_width, max_height, min_width, min_height, aspect_ratio, aspect_tolerance").in("code", codes)
    : { data: [], error: null };
  if (fErr) throw new Error(`ad_formats: ${fErr.message}`);
  const byCode = new Map(((fmts ?? []) as FormatRow[]).map((f) => [f.code, f]));

  let valid = 0;
  let invalid = 0;
  const at = new Date().toISOString();
  for (const cr of creatives) {
    if (cr.validation_status === "blocked") {
      invalid++;
      continue;
    }
    const f = byCode.get(cr.format_code);
    const verdict = f
      ? validateCreative(
          {
            formatCode: cr.format_code,
            mediaType: cr.media_type,
            mimeType: cr.mime_type,
            durationSeconds: cr.duration_seconds === null ? null : Number(cr.duration_seconds),
            fileSizeBytes: cr.file_size_bytes,
            width: cr.width,
            height: cr.height,
            destinationUrl: cr.destination_url,
            headline: cr.headline,
            description: cr.description,
          },
          formatLimits(f),
        )
      : ({ status: "invalid", errors: ["format_unknown"] } as const);
    // syntax, Part 8 safety and the admin blocklist, deep (reputation + redirects) - an empty link is never valid
    let url: DestinationCheck = cr.destination_url ? await checkDestination(db, cr.destination_url, { deep: true }) : { status: "blocked", code: "url_invalid", reason: "missing" };
    // a person already approved THIS exact link (0206): a review-level doubt does not hold it again
    if (url.status === "pending" && cr.url_approved_url && cr.url_approved_url === cr.destination_url) url = { status: "valid" };
    const { error: wErr } = await db
      .from("ad_creatives")
      .update({
        validation_status: verdict.status,
        validation_errors: verdict.errors,
        validated_at: at,
        url_validation_status: url.status,
        url_block_reason: url.status === "valid" ? null : url.reason,
        url_validated_at: at,
      })
      .eq("id", cr.id);
    if (wErr) throw new Error(`ad_creatives update: ${wErr.message}`);
    if (verdict.status === "valid" && url.status === "valid") valid++;
    else invalid++;
  }
  return { valid, invalid };
}

/** The validator's limits from an ad_formats row - the ONE mapping, used by Part 1 and Part 2. */
export function formatLimits(f: FormatRow): CreativeLimits {
  return {
    code: f.code,
    mediaTypes: f.media_types,
    maxDurationSeconds: f.max_duration_seconds,
    maxFileBytes: Number(f.max_file_bytes),
    maxWidth: f.max_width,
    maxHeight: f.max_height,
    minWidth: f.min_width,
    minHeight: f.min_height,
    aspectRatio: f.aspect_ratio === null ? null : Number(f.aspect_ratio),
    aspectTolerance: f.aspect_tolerance === null ? null : Number(f.aspect_tolerance),
  };
}

/* ─────────────────────────────── destinations ─────────────────────────────── */

export type DestinationCheck =
  | { status: "valid" }
  | { status: "blocked"; code: string; reason: string }
  /** a person must look (Part 8): held in validating, never served until approved */
  | { status: "pending"; code: "needs_review"; reason: string };

async function blockedDomain(db: Db, host: string): Promise<string | null> {
  const { data, error } = await db.rpc("ad_domain_blocked", { p_host: host });
  if (error) throw new Error(`ad_domain_blocked: ${error.message}`);
  return typeof data === "string" && data ? data : null;
}

/**
 * The destination verdict.
 *
 *   always  syntax (Part 2) → Part 8 heuristics (redirect parameters, open
 *           redirectors, file TLDs, lookalike and IDN hosts) → the admin's
 *           blocklist. No network.
 *   deep    + reputation (Safe Browsing, when configured) + a restricted probe
 *           of the redirect chain (url-safety.ts: https and 443 only, private
 *           addresses refused at DNS, 5 hops, 4 s, no body). Used when a link
 *           is submitted, edited, and before activation - never on a
 *           hot path.
 *
 * A check that cannot run never makes a link "valid": it is `pending`, and a
 * person decides (docs/AD_PLATFORM.md, Part 8 safe-failure policy).
 */
export async function checkDestination(db: Db, raw: string, opts: { deep?: boolean } = {}): Promise<DestinationCheck> {
  const syntax = checkDestinationUrl(raw);
  if (syntax.status !== "valid") return { status: "blocked", code: "url_invalid", reason: syntax.reason };
  const url = raw.trim();
  const host = new URL(url).hostname.toLowerCase();
  const h = destinationHeuristics(url);
  if (h.verdict === "block") return { status: "blocked", code: "destination_unsafe", reason: h.reason };
  const listed = await blockedDomain(db, host);
  if (listed) return { status: "blocked", code: "destination_blocked", reason: listed };
  let review: string | null = h.verdict === "review" ? h.reason : null;
  if (opts.deep) {
    const rep = await reputationLookup(url);
    if (rep === "unavailable") review ??= "reputation_unavailable";
    else if (rep && rep.verdict === "block") return { status: "blocked", code: "destination_unsafe", reason: rep.reason };
    const chase = await chaseRedirects(url, (hh) => blockedDomain(db, hh));
    if (chase.verdict.verdict === "block") return { status: "blocked", code: "destination_unsafe", reason: chase.verdict.reason };
    if (chase.verdict.verdict === "review") review ??= chase.verdict.reason;
    else if (baseDomain(new URL(chase.final).hostname) !== baseDomain(host)) {
      // lands somewhere else: that place gets the same reputation check, and a person looks
      const rep2 = await reputationLookup(chase.final);
      if (rep2 && rep2 !== "unavailable" && rep2.verdict === "block") return { status: "blocked", code: "destination_unsafe", reason: `redirect_${rep2.reason}` };
      review ??= "redirects_to_other_domain";
    }
  }
  return review ? { status: "pending", code: "needs_review", reason: review } : { status: "valid" };
}

/* ───────────────────────────── activation ───────────────────────────── */

/**
 * Validate, then ask the database to activate. The database re-checks the
 * payment, the advertiser, every creative verdict, the placement and takes a
 * free slot — anything wrong leaves the campaign in `validating` with its
 * flags written down. A valid paid campaign is LIVE when this returns ok.
 */
export async function activateCampaign(db: Db, campaignId: string, actor: { id: string | null; role: "system" | "admin" }): Promise<Rpc> {
  await validateCampaignCreatives(db, campaignId);
  const { data, error } = await db.rpc("activate_ad_campaign", { p_campaign: campaignId, p_actor: actor.id, p_actor_role: actor.role });
  if (error) throw new Error(`activate_ad_campaign: ${error.message}`);
  return data as Rpc;
}

/*
  Payment lives in ./payment-server.ts (Part 3): the existing Paystack + Bachs
  rails, a quote, a verified webhook, then activateCampaign above. Part 1's
  wallet payment and single-campaign card settle were removed with their SQL
  (0197) - ads are not paid from AI credits (owner, Part 3).
*/

/**
 * One status move with optimistic concurrency: two admins acting on the same
 * version — the second is refused as `stale`, never silently overwritten.
 * Admin emergency controls (pause, remove, reject) are this call.
 */
export async function transitionCampaign(
  db: Db,
  input: { campaignId: string; to: CampaignStatus; expectedVersion: number | null; actorId: string | null; actorRole: "system" | "admin" | "advertiser"; reason?: string | null },
): Promise<Rpc> {
  const { data, error } = await db.rpc("transition_ad_campaign", {
    p_campaign: input.campaignId,
    p_to: input.to,
    p_expected_version: input.expectedVersion,
    p_actor: input.actorId,
    p_actor_role: input.actorRole,
    p_reason: input.reason ?? null,
  });
  if (error) throw new Error(`transition_ad_campaign: ${error.message}`);
  return data as Rpc;
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyAdvertiser } from "./ad-notify";
import { AdApplicationError, formatOfCampaign, probeAndPublish, stageCreative, type FinalizeResult } from "./advertiser-server";
import { normalizeDestination, sanitizeText, TEXT_LIMITS } from "./application";
import { moderateCreative } from "./creative-moderation";
import { checkDestination } from "./server";

/**
 * Part 6 — managing a campaign that is already paid for (live, paused, or
 * paid and going live). Nothing here creates a campaign, a payment or a slot:
 *
 *   replacement  stage a new creative → its bytes are checked → swapped in
 *                ATOMICALLY (ad_swap_creative). The live creative serves the
 *                whole time; a failed replacement changes nothing.
 *   details      headline / description / destination: checked here (the link
 *                is never fetched — no SSRF), applied in one statement
 *                (ad_edit_creative_details).
 *   pause/resume the advertiser's own pause only; resume re-runs every
 *                activation check (ad_advertiser_pause → activate_ad_campaign).
 *   extension    a database-priced quote; the same checkout, webhooks and
 *                settle; applied once after VERIFIED payment.
 *
 * Every database function re-checks ownership and the campaign's state under a
 * row lock, and takes the version the advertiser saw (`stale` otherwise).
 * The admin decides what advertisers may do (`settings.ad_advertiser_controls`).
 */

type Db = SupabaseClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refuse = (code: string, status = 400, facts: Record<string, unknown> = {}): never => {
  throw new AdApplicationError(code, status, facts);
};
const MANAGEABLE = ["active", "paused", "paid", "validating"];

/* ─────────────────────────────── admin policy ─────────────────────────────── */

export const AD_ADVERTISER_CONTROLS_KEY = "ad_advertiser_controls";

export interface AdvertiserControls {
  /** replace the image / video of a paid campaign */
  replaceCreative: boolean;
  /** edit headline + description */
  editText: boolean;
  /** change the destination link (always re-checked) */
  editDestination: boolean;
  /** pause and resume their own campaign */
  pauseResume: boolean;
  /** buy more days for a running campaign */
  extensions: boolean;
}

export const DEFAULT_CONTROLS: AdvertiserControls = { replaceCreative: true, editText: true, editDestination: true, pauseResume: true, extensions: true };

export function parseControls(v: unknown): AdvertiserControls {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const b = (k: keyof AdvertiserControls) => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_CONTROLS[k]);
  return { replaceCreative: b("replaceCreative"), editText: b("editText"), editDestination: b("editDestination"), pauseResume: b("pauseResume"), extensions: b("extensions") };
}

export async function loadControls(db: Db): Promise<AdvertiserControls> {
  const { data } = await db.from("settings").select("value").eq("key", AD_ADVERTISER_CONTROLS_KEY).maybeSingle();
  return parseControls(data?.value);
}

/* ─────────────────────────────── ownership ─────────────────────────────── */

interface OwnCampaign {
  id: string;
  status: string;
  version: number;
  placement_id: string;
  end_at: string | null;
}

/** The campaign, if this member's advertiser owns it — 404 otherwise (never "exists but not yours"). */
async function ownCampaign(db: Db, userId: string, campaignId: string): Promise<OwnCampaign> {
  if (!UUID.test(campaignId)) return refuse("not_found", 404);
  const { data } = await db
    .from("ad_campaigns")
    .select("id, status, version, placement_id, end_at, advertisers!inner(user_id, status)")
    .eq("id", campaignId)
    .maybeSingle();
  const row = data as (OwnCampaign & { advertisers: { user_id: string; status: string } | { user_id: string; status: string }[] }) | null;
  const adv = Array.isArray(row?.advertisers) ? row?.advertisers[0] : row?.advertisers;
  if (!row || adv?.user_id !== userId) return refuse("not_found", 404);
  if (adv.status !== "active") return refuse("advertiser_not_active", 403);
  return row;
}

function manageable(c: OwnCampaign) {
  if (!MANAGEABLE.includes(c.status)) refuse("not_editable", 409, { status: c.status });
  if (c.end_at && Date.parse(c.end_at) <= Date.now()) refuse("campaign_ended", 409);
}

const rpcRefusal = (reason: string | undefined): never => {
  const status = reason === "not_found" ? 404 : reason === "stale" ? 409 : 409;
  return refuse(reason === "stale" ? "stale" : (reason ?? "server"), status);
};

/* ─────────────────────────────── creative replacement ─────────────────────────────── */

/** A signed upload target for a REPLACEMENT creative. The live one keeps serving. */
export async function replacementTicket(db: Db, userId: string, input: { campaignId: string; mediaType: string; mimeType: string; sizeBytes: number }) {
  const controls = await loadControls(db);
  if (!controls.replaceCreative) refuse("edit_not_allowed", 403);
  const c = await ownCampaign(db, userId, input.campaignId);
  manageable(c);
  const { data: live } = await db.from("ad_creatives").select("destination_url, headline, description, validation_status").eq("campaign_id", c.id).eq("status", "active").limit(1);
  const cur = live?.[0] as { destination_url: string | null; headline: string | null; description: string | null; validation_status: string } | undefined;
  if (!cur?.destination_url) refuse("no_creative", 409);
  if (cur!.validation_status === "blocked") refuse("blocked", 403);
  const f = await formatOfCampaign(db, c.placement_id);
  const ticket = await stageCreative(db, userId, c.id, f, input, { status: "staged", destination_url: cur!.destination_url!, headline: cur!.headline, description: cur!.description });
  return { ...ticket, version: c.version };
}

/**
 * Check the replacement's REAL bytes; if valid, swap it in atomically. If the
 * bytes fail, or the swap is refused, the live creative is untouched.
 */
export async function finalizeReplacement(db: Db, userId: string, input: { creativeId: string; expectedVersion: number | null }): Promise<FinalizeResult & { swapped: boolean }> {
  if (!UUID.test(input.creativeId)) refuse("not_found", 404);
  const { data: cr } = await db.from("ad_creatives").select("id, campaign_id, storage_path, status, destination_url").eq("id", input.creativeId).maybeSingle();
  if (!cr || cr.status !== "staged" || !cr.storage_path) return refuse("not_found", 404);
  const c = await ownCampaign(db, userId, cr.campaign_id as string);
  if (!(cr.storage_path as string).startsWith(`${userId}/${c.id}/`)) refuse("not_found", 404);
  manageable(c);
  const f = await formatOfCampaign(db, c.placement_id);
  const result = await probeAndPublish(db, { id: cr.id as string, storage_path: cr.storage_path as string }, f, "replacement");
  if (!result.ok) {
    await notifyAdvertiser(db, c.id, { kind: "creative_rejected" });
    return { ...result, swapped: false };
  }
  // 0208: an oversized video is being transcoded — the LIVE creative keeps serving until it is ready
  if (result.processing) return { ...result, swapped: false };
  await swapIn(db, userId, c.id, cr.id as string, cr.destination_url as string, result.moderation ?? null, input.expectedVersion);
  return { ...result, swapped: true };
}

/**
 * The swap itself, shared by an instant replacement and a processed video's
 * (media-processing.ts). Refuses — leaving the live creative untouched — when
 * a person must look first or the link is now blocked.
 */
async function swapIn(db: Db, userId: string, campaignId: string, creativeId: string, destination: string, moderation: string | null, expectedVersion: number | null): Promise<void> {
  // Part 8: a replacement a person must look at never swaps in by itself; the live creative stays
  if (moderation === "review") {
    await db.from("ad_creatives").update({ status: "removed" }).eq("id", creativeId);
    refuse("content_needs_review", 409);
  }
  // the link it carries is the live one — re-checked now, in case the blocklist changed
  // only a hard block stops the swap: this link is the live one, already through its own checks
  const dest = await checkDestination(db, destination);
  if (dest.status === "blocked") {
    await db.from("ad_creatives").update({ url_validation_status: "blocked", url_block_reason: dest.reason }).eq("id", creativeId);
    refuse("destination_blocked", 409);
  }
  const { data, error } = await db.rpc("ad_swap_creative", { p_campaign: campaignId, p_user: userId, p_new: creativeId, p_expected_version: expectedVersion });
  if (error) throw new Error(`ad_swap_creative: ${error.message}`);
  const r = data as { ok: boolean; reason?: string };
  if (!r.ok) rpcRefusal(r.reason);
  await notifyAdvertiser(db, campaignId, { kind: "creative_approved" });
}

/**
 * A replacement video Cloudflare Stream has finished (0208): swap it in now,
 * as the advertiser would have had it been small enough to serve as uploaded.
 * The version check is skipped on purpose — the advertiser is no longer
 * waiting on a form; edits made meanwhile are words and links, which the
 * swap keeps from the live row.
 */
export async function swapProcessedReplacement(db: Db, campaignId: string, creativeId: string): Promise<void> {
  const { data } = await db.from("ad_creatives").select("destination_url, moderation_status, status").eq("id", creativeId).maybeSingle();
  if (!data || data.status !== "staged") return;
  const { data: camp } = await db.from("ad_campaigns").select("advertisers!inner(user_id)").eq("id", campaignId).maybeSingle();
  const adv = (camp as { advertisers?: { user_id: string } | { user_id: string }[] } | null)?.advertisers;
  const userId = Array.isArray(adv) ? adv[0]?.user_id : adv?.user_id;
  if (!userId) return;
  await swapIn(db, userId, campaignId, creativeId, data.destination_url as string, (data.moderation_status as string | null) ?? null, null);
}

/* ─────────────────────────────── words + link ─────────────────────────────── */

export async function editDetails(
  db: Db,
  userId: string,
  input: { campaignId: string; expectedVersion: number | null; headline?: unknown; description?: unknown; destinationUrl?: unknown },
): Promise<{ version: number; changed: string[] }> {
  const controls = await loadControls(db);
  const c = await ownCampaign(db, userId, input.campaignId);
  manageable(c);
  const has = (v: unknown) => typeof v === "string";
  if ((has(input.headline) || has(input.description)) && !controls.editText) refuse("edit_not_allowed", 403);
  if (has(input.destinationUrl) && !controls.editDestination) refuse("edit_not_allowed", 403);

  const headline = has(input.headline) ? sanitizeText(input.headline, TEXT_LIMITS.headline) : null;
  const description = has(input.description) ? sanitizeText(input.description, TEXT_LIMITS.description) : null;
  let destination: string | null = null;
  if (has(input.destinationUrl)) {
    destination = normalizeDestination(input.destinationUrl as string);
    // Part 8: a live link changes only after the full check (syntax, safety, blocklist, reputation,
    // where it really goes). A doubt keeps the old link serving and says a person must look.
    const verdict = await checkDestination(db, destination, { deep: true });
    if (verdict.status === "pending") refuse("needs_review", 409, { reason: verdict.reason });
    if (verdict.status === "blocked") refuse(verdict.code === "url_invalid" ? "url_invalid" : "destination_blocked", 400, { reason: verdict.reason });
  }
  // Part 8: new words go live only if they pass the content check; a doubt keeps the old copy serving
  if (headline !== null || description !== null || destination !== null) {
    const check = await moderateCreative({ texts: [headline, description], destinationHost: destination ? new URL(destination).hostname : null });
    if (check.status === "rejected") refuse("content_rejected", 400);
    if (check.status === "review") refuse("content_needs_review", 409);
  }
  const { data, error } = await db.rpc("ad_edit_creative_details", {
    p_campaign: c.id, p_user: userId, p_expected_version: input.expectedVersion,
    p_headline: headline, p_description: description, p_destination: destination,
  });
  if (error) throw new Error(`ad_edit_creative_details: ${error.message}`);
  const r = data as { ok: boolean; reason?: string; version?: number; changed?: string[] };
  if (!r.ok) rpcRefusal(r.reason);
  return { version: r.version!, changed: r.changed ?? [] };
}

/* ─────────────────────────────── pause / resume ─────────────────────────────── */

export async function setPaused(db: Db, userId: string, input: { campaignId: string; pause: boolean; expectedVersion: number | null }): Promise<{ status: string }> {
  const controls = await loadControls(db);
  if (!controls.pauseResume) refuse("control_not_allowed", 403);
  const c = await ownCampaign(db, userId, input.campaignId);
  const { data, error } = await db.rpc("ad_advertiser_pause", { p_campaign: c.id, p_user: userId, p_pause: input.pause, p_expected_version: input.expectedVersion });
  if (error) throw new Error(`ad_advertiser_pause: ${error.message}`);
  const r = data as { ok: boolean; reason?: string; flags?: string[] };
  if (!r.ok) {
    if (r.reason === "flagged") {
      await notifyAdvertiser(db, c.id, { kind: "needs_review" });
      refuse("resume_flagged", 409, { flags: r.flags ?? [] });
    }
    rpcRefusal(r.reason);
  }
  await notifyAdvertiser(db, c.id, { kind: input.pause ? "paused" : "resumed" });
  const { data: now } = await db.from("ad_campaigns").select("status").eq("id", c.id).maybeSingle();
  return { status: (now?.status as string) ?? (input.pause ? "paused" : "active") };
}

/* ─────────────────────────────── extension ─────────────────────────────── */

export interface ExtensionQuote {
  quoteId: string;
  extensionId: string;
  expiresAt: string;
  currency: string;
  total: number;
  list: number;
  discountPercent: number;
  days: number;
  extraDays: number;
  currentEndAt: string;
  newEndAt: string;
}

export async function extensionQuote(db: Db, userId: string, input: { campaignId: string; durationId: string }): Promise<ExtensionQuote> {
  const controls = await loadControls(db);
  if (!controls.extensions) refuse("extension_not_allowed", 403);
  const c = await ownCampaign(db, userId, input.campaignId);
  if (!UUID.test(input.durationId)) refuse("duration_unavailable");
  const { data, error } = await db.rpc("ad_extension_quote", { p_user: userId, p_campaign: c.id, p_duration: input.durationId });
  if (error) throw new Error(`ad_extension_quote: ${error.message}`);
  const r = data as { ok: boolean; reason?: string } & Partial<ExtensionQuote>;
  if (!r.ok) rpcRefusal(r.reason);
  return {
    quoteId: r.quoteId!, extensionId: r.extensionId!, expiresAt: r.expiresAt!, currency: r.currency!, total: Number(r.total), list: Number(r.list),
    discountPercent: Number(r.discountPercent), days: Number(r.days), extraDays: Number(r.extraDays), currentEndAt: r.currentEndAt!, newEndAt: r.newEndAt!,
  };
}

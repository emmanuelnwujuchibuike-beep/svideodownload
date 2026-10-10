import "server-only";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyAdvertiser } from "./ad-notify";
import { sanitizeText, TEXT_LIMITS } from "./application";
import { moderateCreative, type ModerationStatus } from "./creative-moderation";
import { IMAGE_MIME_TYPES, validateCreative, VIDEO_MIME_TYPES } from "./creative-validation";
import { probeMedia, sniff, type MediaFacts } from "./media-probe";
import { startVideoProcessing } from "./media-processing";
import { canServeOriginalVideo, specOf, videoNeedsProcessing } from "./media-spec";
import { deleteStreamVideo } from "@/lib/media/stream";
import { maxPlacements, offeredDurations, offeredPlacements, parseCatalog, type AdCatalog } from "./offer";
import { ADVERTISING_RULES_VERSION } from "./rules";
import { createQuote } from "./payment-server";
import { checkDestination, formatLimits, transitionCampaign, type FormatRow } from "./server";

/**
 * The advertiser application, server side (Part 2).
 *
 * The browser keeps the form in its own state and calls here only at the
 * checkpoints that need authority — about five calls for a whole application:
 *
 *   saveDraft       entering the upload step, and "Save draft"
 *   uploadTicket    a signed PUT target in the PRIVATE staging bucket
 *   finalizeUpload  read the REAL bytes, decide, publish or discard
 *   submit          rules on record, destination checked, price locked
 *
 * Every choice the browser sends (format, placement, duration, file facts,
 * price, promotion) is re-derived here from the database. Bytes never pass
 * through this process: the browser PUTs to Supabase, and the checks read
 * headers by range.
 */

type Db = SupabaseClient;
export const STAGING_BUCKET = "ad-creatives-staging";
export const PUBLIC_BUCKET = "ad-creatives";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EDITABLE = ["draft", "awaiting_payment"];
const POSTER_MAX_BYTES = 600 * 1024;

/** A refusal the advertiser can read: a code for `adMessage`, the facts behind it, an HTTP status. */
export class AdApplicationError extends Error {
  constructor(public code: string, public status = 400, public facts: Record<string, unknown> = {}) {
    super(code);
  }
}
const refuse = (code: string, status = 400, facts: Record<string, unknown> = {}): never => {
  throw new AdApplicationError(code, status, facts);
};

export async function loadCatalog(db: Db): Promise<AdCatalog> {
  const { data, error } = await db.rpc("ad_catalog");
  const cat = error ? null : parseCatalog(data);
  if (!cat) {
    if (error) console.error("[ads-platform] ad_catalog failed", { error: error.message });
    return refuse("format_unavailable", 503);
  }
  return cat;
}

/* ─────────────────────────── advertiser + ownership ─────────────────────────── */

async function ensureAdvertiser(db: Db, userId: string, businessName: string | null): Promise<{ id: string; status: string }> {
  const { data: existing, error } = await db.from("advertisers").select("id, status, business_name").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`advertisers: ${error.message}`);
  if (existing) {
    if (businessName && businessName !== existing.business_name) {
      await db.from("advertisers").update({ business_name: businessName, display_name: businessName.slice(0, 60) }).eq("id", existing.id);
    }
    return existing;
  }
  // A placeholder name until the details step — the member's own display name.
  let name = businessName;
  if (!name) {
    const { data: prof } = await db.from("profiles").select("display_name, handle").eq("id", userId).maybeSingle();
    name = sanitizeText(prof?.display_name || prof?.handle || "My business", TEXT_LIMITS.businessName) || "My business";
  }
  const { data: created, error: cErr } = await db
    .from("advertisers")
    .upsert({ user_id: userId, business_name: name, display_name: name.slice(0, 60) }, { onConflict: "user_id" })
    .select("id, status")
    .single();
  if (cErr || !created) throw new Error(`advertisers insert: ${cErr?.message}`);
  return created;
}

interface CampaignRow {
  id: string;
  advertiser_id: string;
  application_id: string | null;
  status: string;
  name: string;
  placement_id: string;
  duration_id: string;
}

/** The application (primary + siblings) if it is this member's, else a refusal. */
async function loadOwnApplication(db: Db, userId: string, campaignId: string) {
  if (!UUID.test(campaignId)) refuse("not_found", 404);
  const { data: adv } = await db.from("advertisers").select("id, status").eq("user_id", userId).maybeSingle();
  if (!adv) return refuse("not_found", 404);
  const { data: primary } = await db.from("ad_campaigns").select("id, advertiser_id, application_id, status, name, placement_id, duration_id").eq("id", campaignId).maybeSingle();
  if (!primary || primary.advertiser_id !== adv.id) return refuse("not_found", 404);
  const appId = (primary as CampaignRow).application_id ?? primary.id;
  const { data: all } = await db.from("ad_campaigns").select("id, advertiser_id, application_id, status, name, placement_id, duration_id").eq("application_id", appId);
  const rows = ((all ?? []) as CampaignRow[]).filter((r) => r.advertiser_id === adv.id);
  const head = rows.find((r) => r.id === appId) ?? (primary as CampaignRow);
  return { advertiser: adv as { id: string; status: string }, primary: head, siblings: rows.filter((r) => r.id !== head.id) };
}

/* ─────────────────────────────────── drafts ─────────────────────────────────── */

export interface DraftInput {
  campaignId?: string | null;
  formatCode: string;
  placementCodes: string[];
  durationId: string;
  name?: string;
  businessName?: string;
}

/** Check a format + placements + duration against the CURRENT catalog. Returns the placement ids. */
async function resolveChoice(db: Db, cat: AdCatalog, input: DraftInput): Promise<{ placementIds: Map<string, string> }> {
  const format = cat.formats.find((f) => f.code === input.formatCode);
  if (!format) return refuse("format_unavailable");
  const codes = [...new Set(input.placementCodes)];
  if (codes.length === 0) return refuse("placement_unavailable");
  if (codes.length > maxPlacements(cat)) return refuse("too_many_placements");
  const offered = new Set(offeredPlacements(cat, format.code).map((p) => p.code));
  if (!codes.every((c) => offered.has(c))) return refuse("placement_unavailable");
  if (!offeredDurations(cat, codes).some((d) => d.id === input.durationId)) return refuse("duration_unavailable");
  const { data } = await db.from("ad_placements").select("id, code").in("code", codes);
  const placementIds = new Map(((data ?? []) as { id: string; code: string }[]).map((p) => [p.code, p.id]));
  if (placementIds.size !== codes.length) return refuse("placement_unavailable");
  return { placementIds };
}

/**
 * Create or update an application at a checkpoint. One campaign per chosen
 * placement (the first is the application), all in `draft`. Editing an
 * application that was ready for payment returns it to draft: its price is
 * locked again at the next submission.
 */
export async function saveDraft(db: Db, userId: string, input: DraftInput): Promise<{ campaignId: string }> {
  const cat = await loadCatalog(db);
  const codes = [...new Set(input.placementCodes)];
  const { placementIds } = await resolveChoice(db, cat, input);
  const businessName = input.businessName ? sanitizeText(input.businessName, TEXT_LIMITS.businessName) || null : null;
  const advertiser = await ensureAdvertiser(db, userId, businessName);
  if (advertiser.status !== "active") refuse("advertiser_not_active", 403);
  const fmt = cat.formats.find((f) => f.code === input.formatCode)!;
  const name = sanitizeText(input.name ?? "", TEXT_LIMITS.name) || `${fmt.name} campaign`;

  if (!input.campaignId) {
    const { count } = await db
      .from("ad_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("advertiser_id", advertiser.id)
      .in("status", EDITABLE);
    const { data: s } = await db.from("ad_platform_settings").select("max_open_drafts").limit(1);
    if ((count ?? 0) >= (s?.[0]?.max_open_drafts ?? 10)) refuse("too_many_drafts", 409);
    const id = randomUUID();
    const rows = codes.map((code, i) => ({
      id: i === 0 ? id : randomUUID(),
      application_id: id,
      advertiser_id: advertiser.id,
      name,
      placement_id: placementIds.get(code)!,
      duration_id: input.durationId,
      status: "draft",
    }));
    const { error } = await db.from("ad_campaigns").insert(rows);
    if (error) throw new Error(`ad_campaigns insert: ${error.message}`);
    return { campaignId: id };
  }

  const app = await loadOwnApplication(db, userId, input.campaignId);
  const all = [app.primary, ...app.siblings];
  if (!all.every((r) => EDITABLE.includes(r.status))) refuse("not_editable", 409);
  for (const r of all.filter((x) => x.status === "awaiting_payment")) {
    await transitionCampaign(db, { campaignId: r.id, to: "draft", expectedVersion: null, actorId: userId, actorRole: "advertiser", reason: "edited" });
  }

  // A format change makes the uploaded creative the wrong shape - it goes.
  const { data: oldPl } = await db.from("ad_placements").select("format_code").eq("id", app.primary.placement_id).maybeSingle();
  if (oldPl && oldPl.format_code !== input.formatCode) {
    await db.from("ad_creatives").update({ status: "removed" }).eq("campaign_id", app.primary.id).neq("status", "removed");
  }

  await db.from("ad_campaigns").update({ name, placement_id: placementIds.get(codes[0]!)!, duration_id: input.durationId }).eq("id", app.primary.id);
  const wanted = new Set(codes.slice(1));
  const keep = app.siblings.filter((s) => [...wanted].some((c) => placementIds.get(c) === s.placement_id));
  const drop = app.siblings.filter((s) => !keep.includes(s));
  if (drop.length) await db.from("ad_campaigns").delete().in("id", drop.map((d) => d.id)).in("status", EDITABLE);
  for (const s of keep) await db.from("ad_campaigns").update({ name, duration_id: input.durationId }).eq("id", s.id);
  const have = new Set(keep.map((k) => k.placement_id));
  const add = [...wanted].filter((c) => !have.has(placementIds.get(c)!));
  if (add.length) {
    const { error } = await db.from("ad_campaigns").insert(
      add.map((code) => ({ id: randomUUID(), application_id: app.primary.id, advertiser_id: app.advertiser.id, name, placement_id: placementIds.get(code)!, duration_id: input.durationId, status: "draft" })),
    );
    if (error) throw new Error(`ad_campaigns insert: ${error.message}`);
  }
  return { campaignId: app.primary.id };
}

/** Discard an unpaid application (cancelled, kept for the audit). */
export async function discardDraft(db: Db, userId: string, campaignId: string): Promise<void> {
  const app = await loadOwnApplication(db, userId, campaignId);
  for (const r of [app.primary, ...app.siblings]) {
    if (EDITABLE.includes(r.status)) {
      await transitionCampaign(db, { campaignId: r.id, to: "cancelled", expectedVersion: null, actorId: userId, actorRole: "advertiser", reason: "discarded" });
    }
  }
}

/* ─────────────────────────────────── uploads ────────────────────────────────── */

export async function formatOfCampaign(db: Db, placementId: string): Promise<FormatRow & { enabled: boolean }> {
  const { data: pl } = await db.from("ad_placements").select("format_code").eq("id", placementId).maybeSingle();
  const { data: f } = await db
    .from("ad_formats")
    // "*": 0208's delivery limits arrive when the migration has run, and nothing breaks before it has
    .select("*")
    .eq("code", pl?.format_code ?? "")
    .maybeSingle();
  if (!f || !f.enabled) return refuse("format_unavailable");
  return f as FormatRow & { enabled: boolean };
}

export interface TicketInput {
  campaignId: string;
  mediaType: string;
  mimeType: string;
  sizeBytes: number;
}

const EXT: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

/**
 * A signed PUT target in the PRIVATE staging bucket for one exact path. The
 * declared type and size are checked to refuse early (and cheaply) — the
 * real check is `finalizeUpload`, on the bytes that landed.
 */
export async function uploadTicket(db: Db, userId: string, input: TicketInput) {
  const app = await loadOwnApplication(db, userId, input.campaignId);
  if (app.primary.status !== "draft") refuse("not_editable", 409);
  const f = await formatOfCampaign(db, app.primary.placement_id);
  return stageCreative(db, userId, app.primary.id, f, input, { status: "active" });
}

/**
 * A signed PUT target for a new creative of one campaign (shared by a draft's
 * upload and a live campaign's replacement, Part 6). Checks the declared type
 * and size against the CURRENT format first; the real bytes are checked again
 * in probeAndPublish. A replacement is `staged`: nothing serves it, and the
 * live creative stays exactly as it is until the swap.
 */
export async function stageCreative(
  db: Db,
  userId: string,
  campaignId: string,
  f: FormatRow & { code: string },
  input: Pick<TicketInput, "mediaType" | "mimeType" | "sizeBytes">,
  row: { status: "active" | "staged"; destination_url?: string; headline?: string | null; description?: string | null },
) {
  if (input.mediaType !== "image" && input.mediaType !== "video") refuse("mime_not_allowed");
  if (!f.media_types.includes(input.mediaType)) refuse("media_type_not_allowed", 400, { mediaType: input.mediaType });
  const allowed: readonly string[] = input.mediaType === "video" ? VIDEO_MIME_TYPES : IMAGE_MIME_TYPES;
  // 0209: a MOV is accepted only when it can be transcoded (it is never served as is)
  if (input.mimeType === "video/quicktime" && !formatLimits(f).videoProcessing) refuse("quicktime");
  if (!allowed.includes(input.mimeType)) refuse("mime_not_allowed");
  const spec = specOf(f);
  const cap = input.mediaType === "video" && formatLimits(f).videoProcessing ? spec.maxUploadBytes : spec.maxServedBytes;
  if (!(input.sizeBytes > 0) || input.sizeBytes > cap) {
    refuse("file_too_large", 400, { mediaType: input.mediaType, fileSizeBytes: input.sizeBytes, maxFileBytes: cap });
  }

  // Abandoned earlier attempts on this application are cleared here, on the
  // hot path - no cron, and staging never accumulates per application.
  const { data: stale } = await db.from("ad_creatives").select("id, storage_path, stream_uid").eq("campaign_id", campaignId).eq("validation_status", "pending").eq("status", row.status);
  if (stale?.length) {
    for (const s of stale) if (s.stream_uid) await deleteStreamVideo(s.stream_uid as string);
    await db.storage.from(STAGING_BUCKET).remove(stale.flatMap((s) => (s.storage_path ? [s.storage_path, posterPath(s.storage_path)] : [])));
    await db.from("ad_creatives").update({ status: "removed" }).in("id", stale.map((s) => s.id));
  }

  const creativeId = randomUUID();
  const path = `${userId}/${campaignId}/${creativeId}.${EXT[input.mimeType]}`;
  const { error: insErr } = await db.from("ad_creatives").insert({
    id: creativeId,
    campaign_id: campaignId,
    format_code: f.code,
    media_type: input.mediaType,
    mime_type: input.mimeType,
    storage_path: path,
    status: row.status,
    validation_status: "pending",
    ...(row.destination_url ? { destination_url: row.destination_url, url_validation_status: "valid" } : {}),
    ...(row.headline !== undefined ? { headline: row.headline } : {}),
    ...(row.description !== undefined ? { description: row.description } : {}),
  });
  if (insErr) throw new Error(`ad_creatives insert: ${insErr.message}`);

  const sign = async (p: string) => {
    const { data, error } = await db.storage.from(STAGING_BUCKET).createSignedUploadUrl(p, { upsert: true });
    if (error || !data?.signedUrl) throw new Error(`signed upload: ${error?.message}`);
    return data.signedUrl.startsWith("http") ? data.signedUrl : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${data.signedUrl}`;
  };
  return {
    creativeId,
    uploadUrl: await sign(path),
    posterUploadUrl: input.mediaType === "video" ? await sign(posterPath(path)) : null,
  };
}

export const posterPath = (p: string) => p.replace(/\.[a-z0-9]+$/, "-poster.webp");

/**
 * A range reader over a staging object through a short-lived signed URL. Reads
 * only what is asked; if storage ever ignored the Range header, the body is
 * cut off after `length` bytes rather than downloaded whole.
 */
async function stagingReader(db: Db, path: string) {
  const { data, error } = await db.storage.from(STAGING_BUCKET).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) return null;
  const url = data.signedUrl;
  let total = 0;
  let contentType: string | null = null;
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res) return new Uint8Array(0);
    if (!res.ok || !res.body) return new Uint8Array(0);
    const range = res.headers.get("content-range");
    if (range) total = Number(range.split("/")[1]) || total;
    else if (res.status === 200) total = Number(res.headers.get("content-length")) || total;
    contentType ??= res.headers.get("content-type");
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    while (got < length) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      parts.push(value);
      got += value.length;
    }
    await reader.cancel().catch(() => {});
    const out = new Uint8Array(Math.min(got, length));
    let at = 0;
    for (const p of parts) {
      out.set(p.subarray(0, Math.min(p.length, out.length - at)), at);
      at += p.length;
      if (at >= out.length) break;
    }
    return res.status === 200 && offset > 0 ? new Uint8Array(0) : out;
  };
  // the first read learns the true size
  const head = await read(0, 64);
  if (head.length === 0) return null;
  return { read, size: () => total, contentType: () => contentType };
}

export interface FinalizeResult {
  ok: boolean;
  errors: string[];
  facts: Partial<MediaFacts> & { fileSizeBytes?: number };
  limits: { maxDurationSeconds: number | null; maxFileBytes: number; minWidth: number | null; minHeight: number | null; maxWidth: number; maxHeight: number };
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  /** Part 8: the content safety outcome when the bytes passed */
  moderation?: ModerationStatus;
  /** 0208: an oversized video handed to Cloudflare Stream — the creative stays pending until it is ready */
  processing?: boolean;
  /** the bytes passed; the content check and the publish finish in the background (draft fast path) */
  checking?: boolean;
}

/**
 * Write a creative's core columns, then — separately — its Part 8 moderation
 * columns. A database without 0206 refuses an update naming unknown columns
 * outright, which would have left the core verdict unwritten; split, the
 * verdict always lands and only the moderation note is lost.
 */
async function writeCreative(db: Db, id: string, core: Record<string, unknown>, moderation: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("ad_creatives").update(core).eq("id", id);
  if (error) throw new Error(`ad_creatives update: ${error.message}`);
  await db.from("ad_creatives").update(moderation).eq("id", id);
}

async function campaignOf(db: Db, creativeId: string): Promise<string | null> {
  const { data } = await db.from("ad_creatives").select("campaign_id").eq("id", creativeId).maybeSingle();
  return (data?.campaign_id as string | undefined) ?? null;
}

/**
 * Decide on an upload from its BYTES. Valid ⇒ copied into the public bucket
 * (inside Supabase - no bytes through here) and the staging copy removed.
 * Invalid ⇒ the staging copy is removed and the reasons are written down.
 * Nothing unvalidated is ever publicly reachable.
 */
export async function finalizeUpload(db: Db, userId: string, creativeId: string): Promise<FinalizeResult> {
  if (!UUID.test(creativeId)) refuse("not_found", 404);
  const { data: cr } = await db.from("ad_creatives").select("id, campaign_id, media_type, storage_path, status, validation_status").eq("id", creativeId).maybeSingle();
  if (!cr || cr.status === "removed" || !cr.storage_path) return refuse("not_found", 404);
  const app = await loadOwnApplication(db, userId, cr.campaign_id);
  if (app.primary.id !== cr.campaign_id || !cr.storage_path.startsWith(`${userId}/${app.primary.id}/`)) refuse("not_found", 404);
  if (app.primary.status !== "draft") refuse("not_editable", 409);
  const f = await formatOfCampaign(db, app.primary.placement_id);
  const result = await probeAndPublish(db, cr as { id: string; storage_path: string }, f, "draft");
  // one creative per application: the new one replaces any earlier one (a processing video does so once it is ready)
  if (result.ok && !result.processing) await db.from("ad_creatives").update({ status: "removed" }).eq("campaign_id", cr.campaign_id).neq("id", cr.id).neq("status", "removed");
  return result;
}

/**
 * Decide on a staged upload from its BYTES (shared by a draft's upload and a
 * live campaign's replacement, Part 6). Valid ⇒ copied into the public bucket
 * (inside Supabase - no bytes through here), the staging copy removed, the row
 * marked valid. Invalid ⇒ the staging copy removed and the reasons written
 * down. It never touches any OTHER creative: what happens to those is the
 * caller's decision (a draft drops them; a live campaign swaps atomically).
 *
 * Part 8 (0206):
 *   · the bytes are LOCKED first: copied (inside Supabase) to a path the
 *     browser's signed upload URL cannot write, then checked and published
 *     from there. A re-upload between the check and the publish can no longer
 *     put unchecked bytes in the public bucket (the audit's TOCTOU finding).
 *   · the sniffed type must match the declared one (`type_mismatch`)
 *   · content safety (creative-moderation.ts): the model reads the locked
 *     image or poster by signed URL. A rejection blocks the creative. A
 *     review publishes the bytes but holds activation for a person.
 */
export async function probeAndPublish(db: Db, cr: { id: string; storage_path: string }, f: FormatRow & { code: string }, kind: "draft" | "replacement" = "draft"): Promise<FinalizeResult> {
  const limits = formatLimits(f);
  const outLimits = { maxDurationSeconds: limits.maxDurationSeconds, maxFileBytes: limits.maxFileBytes, minWidth: limits.minWidth ?? null, minHeight: limits.minHeight ?? null, maxWidth: limits.maxWidth, maxHeight: limits.maxHeight };
  const staging = db.storage.from(STAGING_BUCKET);
  const poster = posterPath(cr.storage_path);
  const locked = `${cr.storage_path}.checked`;
  const lockedPoster = `${poster}.checked`;
  const cleanup = () => staging.remove([cr.storage_path, poster, locked, lockedPoster]);

  // 2026-10-09 ("it should check and load in less than 3 seconds"): independent steps run together
  await staging.remove([locked, lockedPoster]);
  const [{ error: lockErr }, posterCopy] = await Promise.all([staging.copy(cr.storage_path, locked), staging.copy(poster, lockedPoster)]);
  if (lockErr) return refuse("upload_missing", 409);
  const hasPoster = !posterCopy.error;

  const [src, declaredRow] = await Promise.all([
    stagingReader(db, locked),
    db.from("ad_creatives").select("mime_type, headline, description, destination_url").eq("id", cr.id).maybeSingle(),
  ]);
  if (!src) return refuse("upload_missing", 409);
  const declared = declaredRow.data;
  const size = src.size();
  // a video that will be transcoded may be larger than the served limit (0208); nothing larger is even probed
  const sizeCap = Math.max(limits.maxFileBytes, limits.videoProcessing ? (limits.maxUploadBytes ?? 0) : 0);
  const facts = size > sizeCap ? null : await probeMedia(src.read, size);
  const errors: string[] = [];
  if (size > sizeCap) errors.push("file_too_large");
  else if (!facts) errors.push("not_recognised");
  else {
    if (declared?.mime_type && declared.mime_type !== facts.mime) errors.push("type_mismatch");
    const verdict = validateCreative(
      { formatCode: f.code, mediaType: facts.mediaType, mimeType: facts.mime, durationSeconds: facts.durationSeconds, fileSizeBytes: size, width: facts.width, height: facts.height, destinationUrl: null },
      limits,
    );
    errors.push(...verdict.errors);
  }
  const now = new Date().toISOString();
  const factsOut = { ...(facts ?? {}), fileSizeBytes: size };
  const factCols = {
    file_size_bytes: size || null, width: facts?.width ?? null, height: facts?.height ?? null,
    duration_seconds: facts?.durationSeconds ?? null, mime_type: facts?.mime ?? null,
  };

  if (errors.length) {
    await cleanup();
    await db.from("ad_creatives").update({ validation_status: "invalid", validation_errors: errors, validated_at: now, ...factCols }).eq("id", cr.id);
    return { ok: false, errors, facts: factsOut, limits: outLimits, mediaUrl: null, thumbnailUrl: null };
  }

  /*
    Moderation, then transcode-or-publish (Part 8 + 0208) — the slow, network-
    bound half. Nothing here runs before the bytes have passed.
  */
  const publishAll = async (): Promise<FinalizeResult> => {
    // the poster, if the browser made one: a small real image, or nothing
    let posterOk = false;
    if (facts!.mediaType === "video" && hasPoster) {
      const p = await stagingReader(db, lockedPoster);
      if (p && p.size() <= POSTER_MAX_BYTES) {
        const head = await p.read(0, Math.min(p.size(), 64 * 1024));
        posterOk = sniff(head)?.mediaType === "image";
      }
    }

    // content safety on the LOCKED bytes, by signed URL - never through this server
    const look = facts!.mediaType === "image" ? locked : posterOk ? lockedPoster : null;
    const signed = look ? (await staging.createSignedUrl(look, 600)).data?.signedUrl ?? null : null;
    const destHost = (() => {
      try {
        return declared?.destination_url ? new URL(declared.destination_url as string).hostname : null;
      } catch {
        return null;
      }
    })();
    const moderation = await moderateCreative({
      imageUrl: signed,
      videoWithoutPoster: facts!.mediaType === "video" && !posterOk,
      texts: [declared?.headline as string | null, declared?.description as string | null],
      destinationHost: destHost,
    });
    if (moderation.status === "rejected") {
      await cleanup();
      await writeCreative(db, cr.id, { validation_status: "blocked", validation_errors: ["content_rejected", ...moderation.labels], validated_at: now, ...factCols }, { moderation_status: "rejected", moderation_labels: moderation.labels, moderated_at: now });
      return { ok: false, errors: ["content_rejected"], facts: factsOut, limits: outLimits, mediaUrl: null, thumbnailUrl: null, moderation: "rejected" };
    }

    /*
      0208: an oversized VIDEO is not refused and not served as is — Cloudflare
      Stream transcodes it from a signed URL of the locked copy (media-processing.ts).
      The creative stays pending until the processed MP4 is ready; the poster is
      published now so the advertiser sees their video meanwhile.
    */
    let publishedPoster: string | null = null; // the Stream fallback below has already published the poster
    if (facts!.mediaType === "video" && videoNeedsProcessing(facts!.width!, facts!.height!, size, specOf(f), facts!.mime)) {
      let posterUrl: string | null = null;
      if (posterOk) {
        const { error } = await staging.copy(lockedPoster, poster, { destinationBucket: PUBLIC_BUCKET });
        if (!error) posterUrl = db.storage.from(PUBLIC_BUCKET).getPublicUrl(poster).data.publicUrl;
      }
      const started = limits.videoProcessing
        ? await startVideoProcessing(db, cr, locked, kind, f.max_duration_seconds, {
            ...factCols,
            mime_type: facts!.mime,
            thumbnail_url: posterUrl,
            moderation_status: moderation.status,
            moderation_labels: moderation.labels,
            moderated_at: now,
          })
        : { ok: false as const, error: "video_needs_processing" };
      /*
        🔴 LAST RESORT (owner, 2026-10-10: "if cloudflare stream storage is
        full, supabase can be the fallback"). startVideoProcessing already
        hands a video Stream refuses to the WORKER, which compresses it to 480p
        and publishes it from Supabase Storage. Only when the worker cannot be
        reached either does this run: a video every browser plays (MP4, WebM)
        up to ORIGINAL_SERVE_MAX_BYTES is published as uploaded, whole, never
        cropped (the card takes its ratio). A MOV, or anything larger, gets the
        "try again" message until Stream or the worker has room.
      */
      const fallbackToStorage = !started.ok && started.error === "processing_unavailable" && canServeOriginalVideo(facts!.mime, size);
      if (fallbackToStorage) console.warn("[ads] Stream unavailable - serving the original video from storage", { creative: cr.id });
      if (!started.ok && !fallbackToStorage) {
        await cleanup();
        await db.from("ad_creatives").update({ validation_status: "invalid", validation_errors: [started.error], validated_at: now, ...factCols }).eq("id", cr.id);
        return { ok: false, errors: [started.error], facts: factsOut, limits: outLimits, mediaUrl: null, thumbnailUrl: null };
      }
      if (started.ok) return { ok: true, errors: [], facts: factsOut, limits: outLimits, mediaUrl: null, thumbnailUrl: posterUrl, moderation: moderation.status, processing: true };
      publishedPoster = posterUrl;
    }

    let thumbnailUrl: string | null = publishedPoster;
    if (posterOk && !thumbnailUrl) {
      const { error } = await staging.copy(lockedPoster, poster, { destinationBucket: PUBLIC_BUCKET });
      if (!error) thumbnailUrl = db.storage.from(PUBLIC_BUCKET).getPublicUrl(poster).data.publicUrl;
    }
    const { error: copyErr } = await staging.copy(locked, cr.storage_path, { destinationBucket: PUBLIC_BUCKET });
    if (copyErr) throw new Error(`publish creative: ${copyErr.message}`);
    await cleanup();
    const mediaUrl = db.storage.from(PUBLIC_BUCKET).getPublicUrl(cr.storage_path).data.publicUrl;

    await writeCreative(
        db,
        cr.id,
        { media_url: mediaUrl, thumbnail_url: thumbnailUrl, ...factCols, mime_type: facts!.mime, validation_status: "valid", validation_errors: [], validated_at: now },
        { moderation_status: moderation.status, moderation_labels: moderation.labels, moderated_at: now },
      );
    return { ok: true, errors: [], facts: factsOut, limits: outLimits, mediaUrl, thumbnailUrl, moderation: moderation.status };

  };

  /*
    🔴 THE FAST PATH (owner, 2026-10-09: "it keeps showing checking your file,
    it should check and load in less than 3 seconds").

    The advertiser waited for EVERYTHING: ~10 storage round trips plus the AI
    content check (up to 20 s), one after another, and a stalled read had no
    timeout at all. Now a DRAFT answers as soon as its BYTES pass (type, size,
    dimensions, duration — about a second); the content check and the publish
    run after the response (after()).

    It stays safe because the creative is written as validation "pending" and
    moderation "review" until that finishes: activate_ad_campaign refuses both,
    so nothing unchecked can ever go live, and the bytes become public only
    after the content check passes. If the background step never completes, the
    creative stays held — it fails closed.

    A live campaign's REPLACEMENT keeps the synchronous path: it swaps into a
    running ad, so it must be published and checked before it is answered.
  */
  if (kind === "draft") {
    const willProcess = facts!.mediaType === "video" && videoNeedsProcessing(facts!.width!, facts!.height!, size, specOf(f), facts!.mime);
    await writeCreative(db, cr.id, { ...factCols, mime_type: facts!.mime, validation_status: "pending", validation_errors: [], validated_at: now }, { moderation_status: "review", moderation_labels: ["moderation_pending"] });
    after(async () => {
      const r = await publishAll().catch(() => null);
      if (r && !r.ok) await notifyAdvertiser(db, (await campaignOf(db, cr.id)) ?? "", { kind: "creative_rejected" }).catch(() => {});
    });
    return {
      ok: true,
      errors: [],
      facts: factsOut,
      limits: outLimits,
      // the address it will have once published; the browser shows its own local copy meanwhile
      mediaUrl: willProcess ? null : db.storage.from(PUBLIC_BUCKET).getPublicUrl(cr.storage_path).data.publicUrl,
      thumbnailUrl: null,
      processing: willProcess,
      checking: true,
    };
  }
  return publishAll();
}

/* ─────────────────────────────────── submit ─────────────────────────────────── */

export interface SubmitInput {
  campaignId: string;
  name: string;
  businessName: string;
  headline?: string;
  description?: string;
  destinationUrl: string;
  rulesAccepted: boolean;
  rulesVersion: string;
}

export interface LockedQuote {
  /** 0197: the quote the advertiser pays - the only price /api/ads/payment/create accepts */
  quoteId: string;
  expiresAt: string;
  currency: string;
  total: number;
  lines: { campaignId: string; placementCode: string; list: number; discountPercent: number; total: number; durationDays: number; extraDays: number; promotionId: string | null }[];
}

/**
 * Ready for payment: the rules on record, the destination checked, the
 * creative valid, and the price LOCKED by the database (`ad_campaign_quote`)
 * on every campaign of the application. Idempotent — submitting again
 * re-checks and re-locks.
 */
export async function submitApplication(db: Db, userId: string, input: SubmitInput): Promise<LockedQuote> {
  if (input.rulesAccepted !== true) refuse("rules_not_accepted");
  if (input.rulesVersion !== ADVERTISING_RULES_VERSION) refuse("rules_outdated", 409);
  const name = sanitizeText(input.name, TEXT_LIMITS.name);
  const businessName = sanitizeText(input.businessName, TEXT_LIMITS.businessName);
  if (!name || !businessName) refuse("details_missing");
  const headline = sanitizeText(input.headline ?? "", TEXT_LIMITS.headline) || null;
  const description = sanitizeText(input.description ?? "", TEXT_LIMITS.description) || null;
  const destinationUrl = (input.destinationUrl ?? "").trim();

  const cat = await loadCatalog(db);
  const app = await loadOwnApplication(db, userId, input.campaignId);
  const all = [app.primary, ...app.siblings];
  if (app.advertiser.status !== "active") refuse("advertiser_not_active", 403);
  if (!all.every((r) => EDITABLE.includes(r.status))) refuse("not_editable", 409);
  const { data: openPay } = await db.from("ai_topup_attempts").select("reference").eq("purpose", "ad_campaign").eq("item_id", app.primary.id).in("status", ["pending", "verification_required"]).limit(1);
  if (openPay?.length) refuse("payment_in_progress", 409);

  // Part 8: deep check (reputation + where the link really goes). A doubt is not a refusal:
  // the campaign is held for a person after payment, and the advertiser is told so.
  const dest = await checkDestination(db, destinationUrl, { deep: true });
  if (dest.status === "blocked") refuse(dest.code, 400, { reason: dest.reason });
  // Part 8: the words and the link's host against the Advertising Rules (the image was checked at upload)
  const textCheck = await moderateCreative({ texts: [headline, description, businessName, name], destinationHost: new URL(destinationUrl).hostname });
  if (textCheck.status === "rejected") refuse("content_rejected", 400);

  // the upload fast path finishes its content check in the background (a few seconds): give it a moment
  let creatives: Record<string, unknown>[] | null = null;
  for (let tries = 0; tries < 7; tries++) {
    const { data } = await db.from("ad_creatives").select("*").eq("campaign_id", app.primary.id).eq("status", "active");
    creatives = (data ?? []).filter((c) => c.validation_status === "valid");
    const checking = (data ?? []).some((c) => c.validation_status === "pending" && (c.processing_status ?? "none") === "none");
    if (creatives.length || !checking) break;
    if (tries === 6) refuse("creative_checking", 409);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const creative = creatives?.[0];
  if (!creative) refuse("no_creative");

  // the advertiser's name on the profile they advertise under
  await ensureAdvertiser(db, userId, businessName);

  // the creative carries the link and the copy - on every campaign of the application
  const now = new Date().toISOString();
  const copy = {
    destination_url: destinationUrl, headline, description, url_validation_status: dest.status, url_block_reason: dest.status === "pending" ? dest.reason : null, url_validated_at: now,
    // a doubt about the words holds activation for a person; it never clears an image-level doubt
    ...(textCheck.status === "review" ? { moderation_status: "review", moderation_labels: textCheck.labels, moderated_at: now } : {}),
  };
  await db.from("ad_creatives").update(copy).eq("id", creative!.id);
  for (const s of app.siblings) {
    await db.from("ad_creatives").update({ status: "removed" }).eq("campaign_id", s.id).neq("status", "removed");
    const { id: _id, campaign_id: _c, created_at: _ca, updated_at: _ua, ...rest } = creative as Record<string, unknown>;
    const { error } = await db.from("ad_creatives").insert({ ...rest, ...copy, id: randomUUID(), campaign_id: s.id });
    if (error) throw new Error(`ad_creatives copy: ${error.message}`);
  }

  if (!cat.settings.applications_open) refuse("applications_closed", 409);

  // lock the price, per campaign, from the database
  const { data: pls } = await db.from("ad_placements").select("id, code").in("id", all.map((r) => r.placement_id));
  const codeOf = new Map(((pls ?? []) as { id: string; code: string }[]).map((p) => [p.id, p.code]));
  const lines: LockedQuote["lines"] = [];
  for (const r of all) {
    const { data: q, error } = await db.rpc("ad_campaign_quote", { p_campaign: r.id, p_currency: cat.settings.display_currency });
    if (error) throw new Error(`ad_campaign_quote: ${error.message}`);
    const quote = q as { ok: boolean; reason?: string; total: number; list_price: number; discount_percent: number; duration_days: number; extra_days: number; pricing_plan_id: string; promotion_id: string | null };
    if (!quote.ok) refuse(quote.reason ?? "no_price", 409);
    const { error: uErr } = await db.from("ad_campaigns").update({
      name,
      currency: cat.settings.display_currency,
      total_amount_minor: Number(quote.total),
      daily_amount_minor: Math.ceil(Number(quote.total) / Math.max(1, Number(quote.duration_days))),
      pricing_plan_id: quote.pricing_plan_id,
      promotion_id: quote.promotion_id,
      price_snapshot: quote,
      duration_days: Number(quote.duration_days),
      extra_days: Number(quote.extra_days),
      quoted_at: now,
      rules_accepted_at: now,
      rules_version: input.rulesVersion,
    }).eq("id", r.id);
    if (uErr) throw new Error(`ad_campaigns lock: ${uErr.message}`);
    lines.push({
      campaignId: r.id, placementCode: codeOf.get(r.placement_id) ?? "", list: Number(quote.list_price), discountPercent: Number(quote.discount_percent),
      total: Number(quote.total), durationDays: Number(quote.duration_days), extraDays: Number(quote.extra_days), promotionId: quote.promotion_id,
    });
  }
  for (const r of all.filter((x) => x.status === "draft")) {
    const t = await transitionCampaign(db, { campaignId: r.id, to: "awaiting_payment", expectedVersion: null, actorId: userId, actorRole: "advertiser", reason: "submitted" });
    if (!t.ok) throw new Error(`transition: ${t.reason}`);
  }
  const total = lines.reduce((sum, l) => sum + l.total, 0);
  const quote = await createQuote(db, { applicationId: app.primary.id, userId, currency: cat.settings.display_currency, total, lines });
  return { quoteId: quote.id, expiresAt: quote.expiresAt, currency: cat.settings.display_currency, total, lines };
}

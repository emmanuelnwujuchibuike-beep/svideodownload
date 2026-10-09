import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { copyAdVideoToStream, deleteStreamVideo, ensureStreamMp4, getStreamVideo, hasStream, streamThumbnailUrl } from "@/lib/media/stream";

import { notifyAdvertiser } from "./ad-notify";
import { posterPath, STAGING_BUCKET } from "./advertiser-server";

/**
 * Oversized ad VIDEOS are transcoded by Cloudflare Stream (0208, owner
 * 2026-10-09: "A large 4K video must be transcoded to an appropriate delivery
 * resolution rather than rejected solely because it is too large").
 *
 *   start    the checked staging copy is handed to Stream as a SHORT-LIVED
 *            SIGNED URL. Stream pulls the bytes itself — they never pass
 *            through Vercel or Railway, and nothing here holds them in memory.
 *            The creative stays `pending`: activate_ad_campaign refuses a
 *            pending creative, so nothing can go live unprocessed.
 *   advance  idempotent, safe to call from anywhere (the Stream webhook, the
 *            advertiser's status poll, the payment step): reads Stream, asks for
 *            the single-file MP4, and when it is ready publishes it, swaps a
 *            replacement in, and tries activation if the campaign is waiting.
 *   fail     a bounded outcome: a Stream error, a duration over the limit, or
 *            an hour without finishing. The creative is marked invalid with the
 *            reason; for a replacement the LIVE creative is never touched.
 *
 * Stream keeps the aspect ratio and honours rotation metadata, so a portrait
 * video stays portrait and nothing is stretched or cropped; the slot shows it
 * whole (media-spec FIT_RULE).
 */

type Db = SupabaseClient;

/** An hour is generous for a ≤ 200 MB ad video; past it the creative fails rather than waiting forever. */
export const PROCESSING_TIMEOUT_MS = 60 * 60 * 1000;

export const canProcessVideo = hasStream;

export async function startVideoProcessing(
  db: Db,
  cr: { id: string; storage_path: string },
  lockedPath: string,
  kind: "draft" | "replacement",
  maxDurationSeconds: number | null,
  cols: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // a signed URL Stream can fetch for an hour — long enough for the copy to start
  const { data: signed } = await db.storage.from(STAGING_BUCKET).createSignedUrl(lockedPath, 3600);
  const uid = signed?.signedUrl ? await copyAdVideoToStream(signed.signedUrl, cr.id, maxDurationSeconds) : null;
  if (!uid) return { ok: false, error: "processing_unavailable" };
  const { data: prev } = await db.from("ad_creatives").select("processing_attempts").eq("id", cr.id).maybeSingle();
  // Part 8's moderation columns are written on their own: a database without 0206 refuses an update naming them
  const moderation = Object.fromEntries(Object.entries(cols).filter(([k]) => k.startsWith("moderat")));
  const core = Object.fromEntries(Object.entries(cols).filter(([k]) => !k.startsWith("moderat")));
  if (Object.keys(moderation).length) await db.from("ad_creatives").update(moderation).eq("id", cr.id);
  await db
    .from("ad_creatives")
    .update({
      ...core,
      validation_status: "pending",
      validation_errors: [],
      processing_status: "processing",
      processing_kind: kind,
      processing_error: null,
      stream_uid: uid,
      processing_started_at: new Date().toISOString(),
      processing_attempts: Number(prev?.processing_attempts ?? 0) + 1,
    })
    .eq("id", cr.id);
  return { ok: true };
}

export type ProcessingState = { state: "none" | "processing" | "ready" | "failed"; error: string | null; mediaUrl: string | null; thumbnailUrl: string | null };

type Row = {
  id: string;
  campaign_id: string;
  storage_path: string | null;
  status: string;
  processing_status: string | null;
  processing_kind: string | null;
  processing_error: string | null;
  stream_uid: string | null;
  processing_started_at: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  moderation_status: string | null;
  validation_status: string;
  validation_errors: string[] | null;
};

/** The original, its poster, and the locked (".checked") copies of both — everything staging holds for one creative. */
const stagingPaths = (p: string | null) => {
  if (!p) return [];
  const poster = posterPath(p);
  return [p, `${p}.checked`, poster, `${poster}.checked`];
};

async function fail(db: Db, r: Row, code: string): Promise<ProcessingState> {
  await db.storage.from(STAGING_BUCKET).remove(stagingPaths(r.storage_path)).catch(() => {});
  if (r.stream_uid) await deleteStreamVideo(r.stream_uid);
  await db
    .from("ad_creatives")
    .update({ processing_status: "failed", processing_error: code, validation_status: "invalid", validation_errors: [code], validated_at: new Date().toISOString() })
    .eq("id", r.id);
  if (r.processing_kind === "replacement") await notifyAdvertiser(db, r.campaign_id, { kind: "creative_rejected" });
  return { state: "failed", error: code, mediaUrl: null, thumbnailUrl: null };
}

/** Move a processing creative forward if Stream has finished. Idempotent. */
export async function advanceVideoProcessing(db: Db, creativeId: string, now: number = Date.now()): Promise<ProcessingState> {
  const { data } = await db
    .from("ad_creatives")
    .select("id, campaign_id, storage_path, status, processing_status, processing_kind, processing_error, stream_uid, processing_started_at, media_url, thumbnail_url, moderation_status, validation_status, validation_errors")
    .eq("id", creativeId)
    .maybeSingle();
  const r = data as Row | null;
  if (!r) return { state: "failed", error: "not_found", mediaUrl: null, thumbnailUrl: null };
  // refused before it could be transcoded (the bytes, or the background content check)
  if (r.validation_status === "invalid" || r.validation_status === "blocked") {
    return { state: "failed", error: r.validation_errors?.[0] ?? "creative_not_valid", mediaUrl: null, thumbnailUrl: null };
  }
  const state = (r.processing_status ?? "none") as ProcessingState["state"];
  if (state !== "processing") return { state, error: r.processing_error, mediaUrl: r.media_url, thumbnailUrl: r.thumbnail_url };
  if (r.status === "removed" || !r.stream_uid) return fail(db, r, "processing_cancelled");
  if (r.processing_started_at && now - Date.parse(r.processing_started_at) > PROCESSING_TIMEOUT_MS) return fail(db, r, "processing_timeout");

  const v = await getStreamVideo(r.stream_uid);
  if (!v) return { state: "processing", error: null, mediaUrl: null, thumbnailUrl: null }; // Stream unreachable: try again later
  if (v.failed) return fail(db, r, "processing_failed");
  if (!v.ready) return { state: "processing", error: null, mediaUrl: null, thumbnailUrl: null };

  // the duration is re-checked on the TRANSCODED video against the CURRENT limit — never trimmed to fit
  const { data: fmt } = await db.from("ad_formats").select("*").eq("code", (await formatCodeOf(db, r.id)) ?? "").maybeSingle();
  const maxDur = (fmt as { max_duration_seconds?: number | null } | null)?.max_duration_seconds ?? null;
  if (maxDur !== null && v.durationSeconds !== null && v.durationSeconds > maxDur + 0.5) return fail(db, r, "video_too_long");

  const mp4 = await ensureStreamMp4(r.stream_uid);
  if (!mp4) return { state: "processing", error: null, mediaUrl: null, thumbnailUrl: null };
  if (mp4.status === "error") return fail(db, r, "processing_failed");
  if (mp4.status !== "ready" || !mp4.url) return { state: "processing", error: null, mediaUrl: null, thumbnailUrl: null };

  const thumb = streamThumbnailUrl(r.stream_uid) ?? r.thumbnail_url;
  const now_ = new Date().toISOString();
  // claim the transition so two callers cannot both publish and swap
  const { data: claimed } = await db
    .from("ad_creatives")
    .update({
      media_url: mp4.url,
      thumbnail_url: thumb,
      mime_type: "video/mp4",
      duration_seconds: v.durationSeconds,
      delivery_width: v.width,
      delivery_height: v.height,
      processing_status: "ready",
      processing_error: null,
      validation_status: "valid",
      validation_errors: [],
      validated_at: now_,
    })
    .eq("id", r.id)
    .eq("processing_status", "processing")
    .select("id");
  if (!claimed?.length) return advanceVideoProcessing(db, creativeId, now); // someone else finished it
  await db.storage.from(STAGING_BUCKET).remove(stagingPaths(r.storage_path)).catch(() => {});

  if (r.processing_kind === "replacement") {
    const { swapProcessedReplacement } = await import("./campaign-manage");
    await swapProcessedReplacement(db, r.campaign_id, r.id).catch(() => {});
  } else {
    // a draft: one creative per application — the processed one replaces any earlier one
    await db.from("ad_creatives").update({ status: "removed" }).eq("campaign_id", r.campaign_id).neq("id", r.id).neq("status", "removed");
    await tryActivate(db, r.campaign_id);
  }
  return { state: "ready", error: null, mediaUrl: mp4.url, thumbnailUrl: thumb };
}

async function formatCodeOf(db: Db, creativeId: string): Promise<string | null> {
  const { data } = await db.from("ad_creatives").select("format_code").eq("id", creativeId).maybeSingle();
  return (data?.format_code as string | undefined) ?? null;
}

/** A campaign that was paid while its video processed goes live now (the database decides). */
async function tryActivate(db: Db, campaignId: string): Promise<void> {
  const { data } = await db.from("ad_campaigns").select("status").eq("id", campaignId).maybeSingle();
  if (data?.status !== "paid" && data?.status !== "validating") return;
  const { activateCampaign } = await import("./server");
  await activateCampaign(db, campaignId, { id: null, role: "system" }).catch(() => {});
}

/** Advance every processing creative of a campaign (the payment step calls this before activating). */
export async function advanceCampaignProcessing(db: Db, campaignId: string): Promise<void> {
  const { data } = await db.from("ad_creatives").select("id").eq("campaign_id", campaignId).eq("processing_status", "processing");
  for (const row of data ?? []) await advanceVideoProcessing(db, row.id as string).catch(() => {});
}

/** The Stream webhook: find the ad creative a Stream uid belongs to, if any. */
export async function creativeForStreamUid(db: Db, uid: string): Promise<string | null> {
  const { data } = await db.from("ad_creatives").select("id").eq("stream_uid", uid).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

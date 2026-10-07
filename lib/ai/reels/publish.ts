import "server-only";

import { AI_RESULT_BUCKET } from "@/lib/ai/storage";
import { processRewardEvent, type GrantedReward } from "@/lib/rewards/engine";
import { publishPost } from "@/lib/social/posts";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI REELS — a Frenz AI video published to the EXISTING feed, from its job
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rewards brief §4–§5 (2026-10-07). An AI Reel is an ordinary post
 * (`posts`, format `reel`) marked `content_type = 'ai_video'` and tied to its
 * generation by `ai_job_id` (unique: one reel per generation). Likes,
 * comments, saves, views, sharing, reports, moderation and notifications are
 * the feed's own — nothing separate.
 *
 * Nothing about it comes from the browser except the caption: the owner, the
 * completion, the file and the DURATION are the job row's (measured by the
 * server when the result was stored). The result lives in the private results
 * bucket, so it is copied once to the public `post-media` bucket the feed
 * already plays member videos from.
 *
 * Publishing raises `ai_video_shared` in the ONE engine, which checks again —
 * Frenz AI made it, the publisher owns it, it is public, it is at least the
 * operator's minimum length (30 s) — and rewards it at most once per video.
 * Publishing the same generation again returns the reel that exists.
 */
const VIDEO_FEATURES = new Set(["ai_text_to_video", "ai_image_to_video", "ai_lip_sync"]);
const POST_MEDIA_BUCKET = "post-media";

export type PublishAiReelResult =
  | { ok: true; postId: string; created: boolean; rewards: GrantedReward[]; durationSeconds: number | null }
  | { ok: false; status: number; error: string };

export async function publishAiReel(input: { userId: string; jobId: string; caption: string | null; visibility: "public" | "followers" | "private" }): Promise<PublishAiReelResult> {
  const db = createAdminClient();
  const { data: job } = await db.from("ai_jobs").select("id, user_id, feature, status, result_path, result_duration, poster_path").eq("id", input.jobId).maybeSingle();
  const j = job as { id: string; user_id: string | null; feature: string; status: string; result_path: string | null; result_duration: number | string | null; poster_path: string | null } | null;
  if (!j || j.user_id !== input.userId) return { ok: false, status: 404, error: "That creation isn't yours." };
  if (!VIDEO_FEATURES.has(j.feature)) return { ok: false, status: 400, error: "Only Frenz AI videos can be published to Reels." };
  if (j.status !== "completed" || !j.result_path) return { ok: false, status: 409, error: "This video isn't finished yet." };
  const durationSeconds = j.result_duration === null ? null : Number(j.result_duration);

  // the same generation again → the reel that exists (and the engine is asked again: idempotent, so a missed reward is caught)
  const existing = await db.from("posts").select("id").eq("ai_job_id", j.id).maybeSingle();
  const existingId = (existing.data as { id?: string } | null)?.id;
  if (existingId) {
    const rewards = await processRewardEvent({ eventType: "ai_video_shared", actorUserId: input.userId, sourceType: "ai_job", sourceId: j.id, metadata: { post_id: existingId } });
    return { ok: true, postId: existingId, created: false, rewards, durationSeconds };
  }

  // the file: private result → public post media, once
  const { data: file, error: dlErr } = await db.storage.from(AI_RESULT_BUCKET).download(j.result_path);
  if (dlErr || !file) {
    console.error("[ai/reels] result download failed", { jobId: j.id, message: dlErr?.message });
    return { ok: false, status: 503, error: "Couldn't publish right now. Try again in a moment." };
  }
  const path = `ai/${input.userId}/${j.id}.mp4`;
  const { error: upErr } = await db.storage.from(POST_MEDIA_BUCKET).upload(path, file, { contentType: "video/mp4", upsert: true, cacheControl: "31536000" });
  if (upErr) {
    console.error("[ai/reels] copy to post-media failed", { jobId: j.id, message: upErr.message });
    return { ok: false, status: 503, error: "Couldn't publish right now. Try again in a moment." };
  }
  const mediaUrl = db.storage.from(POST_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  let thumbnailUrl: string | null = null;
  if (j.poster_path) {
    const { data: poster } = await db.storage.from(AI_RESULT_BUCKET).download(j.poster_path);
    if (poster) {
      const ppath = `ai/${input.userId}/${j.id}.jpg`;
      const { error } = await db.storage.from(POST_MEDIA_BUCKET).upload(ppath, poster, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
      if (!error) thumbnailUrl = db.storage.from(POST_MEDIA_BUCKET).getPublicUrl(ppath).data.publicUrl;
    }
  }

  const published = await publishPost(input.userId, {
    sourceUrl: mediaUrl,
    platform: "frenz_ai",
    sourceAuthor: null,
    mediaKind: "video",
    title: (input.caption ?? "").trim() || "Made with Frenz AI",
    thumbnailUrl,
    durationSec: durationSeconds !== null && Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
    visibility: input.visibility,
  });
  if (!published.ok) return { ok: false, status: published.code === "forbidden" ? 403 : published.code === "duplicate" ? 409 : 400, error: published.error };

  // the marks only the server writes: an AI video, this generation, a reel
  const { error: markErr } = await db.from("posts").update({ content_type: "ai_video", ai_job_id: j.id, format: "reel", media_url: mediaUrl }).eq("id", published.id).eq("publisher_id", input.userId);
  if (markErr) {
    // a second publish of the same job raced us to the unique ai_job_id — keep theirs, drop ours
    console.error("[ai/reels] marking failed", { jobId: j.id, postId: published.id, message: markErr.message });
    await db.from("posts").delete().eq("id", published.id).eq("publisher_id", input.userId);
    const again = await db.from("posts").select("id").eq("ai_job_id", j.id).maybeSingle();
    const id = (again.data as { id?: string } | null)?.id;
    if (!id) return { ok: false, status: 503, error: "Couldn't publish right now. Try again in a moment." };
    return { ok: true, postId: id, created: false, rewards: [], durationSeconds };
  }
  console.info("[ai/reels] published", { jobId: j.id, postId: published.id, durationSeconds, visibility: input.visibility });
  const rewards = await processRewardEvent({ eventType: "ai_video_shared", actorUserId: input.userId, sourceType: "ai_job", sourceId: j.id, metadata: { post_id: published.id } });
  return { ok: true, postId: published.id, created: true, rewards, durationSeconds };
}

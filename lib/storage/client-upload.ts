"use client";

import { beginCriticalActivity } from "@/lib/pwa/activity-lock";
import { createClient } from "@/lib/supabase/client";

import { MEDIA_CACHE_CONTROL, MEDIA_MAX_AGE_SECONDS } from "./cache-control";
import { POST_BUCKET } from "./index";

export type UploadPlan =
  | { backend: "r2"; key: string; uploadUrl: string; publicUrl: string }
  | { backend: "supabase"; key: string };

/**
 * Ask the server for an upload plan (/api/uploads/presign) — a presigned R2
 * PUT URL when Cloudflare R2 is configured, else a Supabase object key. Pure
 * signature generation server-side (no bytes move, no row is created), so
 * this is safe and cheap to call ahead of an actual upload — see
 * `uploadWithPlan`, and `download-player.tsx`'s publish flow, which requests
 * a plan the moment the ••• sheet opens (real user intent to maybe publish)
 * instead of only after "Publish" is tapped, shaving that round-trip off the
 * critical path. R2 presigned URLs are short-lived (5 min), so a caller that
 * prefetches should fall back to a fresh `presignUpload` if the PUT fails.
 */
export async function presignUpload(kind: "video" | "audio" | "image" | "document", ext: string): Promise<UploadPlan> {
  const res = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ext }),
  });
  const json = (await res.json()) as { ok: true; data: UploadPlan } | { ok: false; error: { message: string } };
  if (!res.ok || !json.ok) {
    throw new Error(!json.ok ? json.error.message : "Couldn't start the upload.");
  }
  return json.data;
}

/** Execute an already-obtained upload plan against real bytes. */
export async function uploadWithPlan(plan: UploadPlan, data: Blob | File, contentType: string): Promise<string> {
  // Held for the actual byte transfer only — a service-worker-driven reload
  // mid-PUT would silently drop the upload with no way to resume it.
  const endCriticalActivity = beginCriticalActivity();
  try {
    if (plan.backend === "r2") {
      const put = await fetch(plan.uploadUrl, {
        method: "PUT",
        body: data,
        // Cache-Control is stored as object metadata and then served on every
        // GET. WITHOUT it, R2 returned no Cache-Control and no Last-Modified, so
        // browsers had nothing to compute freshness from and re-fetched the file
        // on every mount — measured live on a real 1.4MB chat video, which also
        // came back `Cf-Cache-Status: DYNAMIC`, i.e. Cloudflare wasn't caching it
        // either and every view billed R2 egress. That is the actual cause of
        // "the video sent in chat reloads each time someone enters the chat".
        //
        // Server-side putR2() has always set this; only the browser upload path
        // (chat media, stories, posts — i.e. nearly everything) missed it.
        //
        // Sent unsigned, exactly like Content-Type directly above: the presigned
        // URL uses query signing, so headers outside SignedHeaders don't break
        // the signature but ARE still stored. Content-Type proves the mechanism
        // — the live object came back `Content-Type: video/mp4`.
        headers: { "Content-Type": contentType, "Cache-Control": MEDIA_CACHE_CONTROL },
      });
      if (!put.ok) throw new Error("Upload failed. Please try again.");
      return plan.publicUrl;
    }

    // Supabase fallback — upload to the server-chosen, owner-scoped key.
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(POST_BUCKET)
      // 1h was far too short for content that can never change: every upload key
      // is unique, so the bytes at a URL are immutable and can be cached for a
      // year. This is Supabase's egress being paid over and over for no reason
      // (the 5GB cap has already been hit once).
      .upload(plan.key, data, { upsert: true, contentType, cacheControl: String(MEDIA_MAX_AGE_SECONDS) });
    if (error) throw new Error("Upload failed. Try a smaller file.");
    const { data: pub } = supabase.storage.from(POST_BUCKET).getPublicUrl(plan.key);
    return pub.publicUrl;
  } finally {
    endCriticalActivity();
  }
}

/**
 * Upload post/reel/story media from the browser and get back its public URL.
 * Convenience wrapper over `presignUpload` + `uploadWithPlan` for callers
 * that don't need to prefetch the plan ahead of time.
 */
export async function uploadPostMedia(opts: {
  data: Blob | File;
  kind: "video" | "audio" | "image" | "document";
  ext: string;
  contentType: string;
}): Promise<string> {
  const plan = await presignUpload(opts.kind, opts.ext);
  return uploadWithPlan(plan, opts.data, opts.contentType);
}

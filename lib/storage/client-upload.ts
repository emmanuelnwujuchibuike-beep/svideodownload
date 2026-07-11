"use client";

import { beginCriticalActivity } from "@/lib/pwa/activity-lock";
import { createClient } from "@/lib/supabase/client";

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
export async function presignUpload(kind: "video" | "audio" | "image", ext: string): Promise<UploadPlan> {
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
        headers: { "Content-Type": contentType },
      });
      if (!put.ok) throw new Error("Upload failed. Please try again.");
      return plan.publicUrl;
    }

    // Supabase fallback — upload to the server-chosen, owner-scoped key.
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(POST_BUCKET)
      .upload(plan.key, data, { upsert: true, contentType, cacheControl: "3600" });
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
  kind: "video" | "audio" | "image";
  ext: string;
  contentType: string;
}): Promise<string> {
  const plan = await presignUpload(opts.kind, opts.ext);
  return uploadWithPlan(plan, opts.data, opts.contentType);
}

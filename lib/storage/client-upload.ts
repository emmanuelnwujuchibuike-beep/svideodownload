"use client";

import { createClient } from "@/lib/supabase/client";

import { POST_BUCKET } from "./index";

/**
 * Upload post/reel/story media from the browser and get back its public URL.
 *
 * Asks the server for an upload plan (/api/uploads/presign): if Cloudflare R2 is
 * configured it uploads the bytes straight to R2 via a presigned URL (nothing
 * flows through our server); otherwise it falls back to the Supabase SDK exactly
 * as before. Callers don't need to know which backend is active.
 */
export async function uploadPostMedia(opts: {
  data: Blob | File;
  kind: "video" | "audio" | "image";
  ext: string;
  contentType: string;
}): Promise<string> {
  const res = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: opts.kind, ext: opts.ext }),
  });
  const json = (await res.json()) as
    | { ok: true; data: { backend: "r2"; key: string; uploadUrl: string; publicUrl: string } | { backend: "supabase"; key: string } }
    | { ok: false; error: { message: string } };
  if (!res.ok || !json.ok) {
    throw new Error(!json.ok ? json.error.message : "Couldn't start the upload.");
  }
  const plan = json.data;

  if (plan.backend === "r2") {
    const put = await fetch(plan.uploadUrl, {
      method: "PUT",
      body: opts.data,
      headers: { "Content-Type": opts.contentType },
    });
    if (!put.ok) throw new Error("Upload failed. Please try again.");
    return plan.publicUrl;
  }

  // Supabase fallback — upload to the server-chosen, owner-scoped key.
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(POST_BUCKET)
    .upload(plan.key, opts.data, { upsert: true, contentType: opts.contentType, cacheControl: "3600" });
  if (error) throw new Error("Upload failed. Try a smaller file.");
  const { data: pub } = supabase.storage.from(POST_BUCKET).getPublicUrl(plan.key);
  return pub.publicUrl;
}

"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Wallpapers upload straight to storage (2026-10-26 — lib/wallpapers-upload.ts): sign every file, PUT each one to its
 * signed URL from the browser (full resolution, never through a Vercel function and its ~4.5 MB body limit), then ask
 * the server to turn each stored file into a wallpaper. Two at a time, so a batch from a phone is neither serial-slow
 * nor a burst. Every file's outcome is reported, so a failure names the file instead of the whole batch dying.
 */
export interface DirectUploadResult {
  created: number;
  failed: string[];
  lowRes: string[];
  error?: string;
}

export async function uploadWallpapersDirect(
  endpoint: "/api/wallpapers/upload" | "/api/admin/wallpapers/upload",
  files: File[],
  opts: { name?: string; category?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<DirectUploadResult> {
  const post = async (body: unknown) => {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok && json.ok !== false, json };
  };

  const signed = await post({ step: "sign", files: files.map((f) => ({ type: f.type, size: f.size })) });
  const uploads = signed.json.uploads as { key: string; token: string }[] | undefined;
  if (!signed.ok || !uploads || uploads.length !== files.length) return { created: 0, failed: [], lowRes: [], error: (signed.json.error as string) ?? "Couldn't prepare the upload." };

  const storage = createClient().storage.from("wallpapers");
  const result: DirectUploadResult = { created: 0, failed: [], lowRes: [] };
  let done = 0;
  const one = async (i: number) => {
    const file = files[i]!;
    const { key, token } = uploads[i]!;
    try {
      const { error } = await storage.uploadToSignedUrl(key, token, file, { contentType: file.type, cacheControl: "31536000" });
      if (error) throw new Error(error.message);
      const committed = await post({ step: "commit", key, name: opts.name ?? "", category: opts.category ?? "", index: i + 1, batchSize: files.length, filename: file.name });
      if (!committed.ok) throw new Error((committed.json.error as string) ?? "failed");
      result.created += 1;
      if (typeof committed.json.lowRes === "string") result.lowRes.push(committed.json.lowRes);
    } catch (e) {
      result.failed.push(`${file.name}: ${e instanceof Error ? e.message : "failed"}`);
    } finally {
      opts.onProgress?.(++done, files.length);
    }
  };
  // two lanes
  let next = 0;
  await Promise.all(
    [0, 1].map(async () => {
      while (next < files.length) await one(next++);
    }),
  );
  return result;
}

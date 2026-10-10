import "server-only";

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAdTranscodeArgs } from "@/lib/ads-platform/ad-transcode-plan";
import { PUBLIC_BUCKET, STAGING_BUCKET } from "@/lib/ads-platform/advertiser-server";
import { WORKER_TRANSCODE, fail, publishProcessed, type ProcessingState, type Row } from "@/lib/ads-platform/media-processing";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
/** A ≤ 200 MB ad video at `veryfast` takes well under this; past it the job fails rather than hanging. */
const TRANSCODE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * WORKER ONLY — the ad video Stream could not take (2026-10-10: Stream storage
 * full), compressed to 480p with ffmpeg and published from Supabase Storage.
 *
 * Everything is read from the creative row: the locked staging copy (the bytes
 * that passed validation and moderation), the format's duration limit, and
 * where the result goes. It goes live only through `publishProcessed`, the same
 * claim → swap/activate step a Stream MP4 uses, so a replacement still never
 * touches the live creative until its own file is ready.
 */
export async function runAdVideoTranscode(db: SupabaseClient, creativeId: string): Promise<ProcessingState | { state: "skipped" }> {
  const { data } = await db
    .from("ad_creatives")
    .select("id, campaign_id, storage_path, status, processing_status, processing_kind, processing_error, stream_uid, processing_started_at, media_url, thumbnail_url, moderation_status, validation_status, validation_errors, format_code")
    .eq("id", creativeId)
    .maybeSingle();
  const r = data as (Row & { format_code: string | null }) | null;
  // only a creative waiting for THIS worker — anything else (Stream's, finished, failed) is not ours
  if (!r || r.processing_status !== "processing" || r.stream_uid !== WORKER_TRANSCODE || !r.storage_path) return { state: "skipped" };
  if (r.status === "removed") return fail(db, r, "processing_cancelled");

  const dir = await mkdtemp(join(tmpdir(), "ad-transcode-"));
  try {
    const { data: signed } = await db.storage.from(STAGING_BUCKET).createSignedUrl(`${r.storage_path}.checked`, 3600);
    if (!signed?.signedUrl) return fail(db, r, "processing_failed");
    const input = join(dir, "in");
    const output = join(dir, "out.mp4");
    const res = await fetch(signed.signedUrl);
    if (!res.ok || !res.body) return fail(db, r, "processing_failed");
    // streamed to disk — a 200 MB upload is never held in memory
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(input));

    await run(FFMPEG, buildAdTranscodeArgs(input, output), TRANSCODE_TIMEOUT_MS);
    const probe = await probeVideo(output);
    if (!probe) return fail(db, r, "processing_failed");

    // the duration is checked on the RESULT against the CURRENT limit — never trimmed to fit (as for Stream)
    const { data: fmt } = await db.from("ad_formats").select("max_duration_seconds").eq("code", r.format_code ?? "").maybeSingle();
    const maxDur = (fmt as { max_duration_seconds?: number | null } | null)?.max_duration_seconds ?? null;
    if (maxDur !== null && probe.durationSeconds !== null && probe.durationSeconds > maxDur + 0.5) return fail(db, r, "video_too_long");

    // the 480p file is a few MB: read once and uploaded next to where an unprocessed creative would live
    const dest = `${r.storage_path.replace(/\.[a-z0-9]+$/i, "")}-480.mp4`;
    const { error } = await db.storage.from(PUBLIC_BUCKET).upload(dest, await readFile(output), { contentType: "video/mp4", upsert: true, cacheControl: "31536000" });
    if (error) {
      console.error("[ads] transcode upload failed", error.message);
      return fail(db, r, "processing_failed");
    }
    const mediaUrl = db.storage.from(PUBLIC_BUCKET).getPublicUrl(dest).data.publicUrl;
    return (
      (await publishProcessed(db, r, { mediaUrl, thumbnailUrl: r.thumbnail_url, durationSeconds: probe.durationSeconds, width: probe.width, height: probe.height })) ?? { state: "skipped" }
    );
  } catch (e) {
    console.error("[ads] transcode failed", e instanceof Error ? e.message.slice(0, 300) : "error");
    return fail(db, r, "processing_failed");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-2000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited ${code}: ${err}`));
    });
  });
}

async function probeVideo(file: string): Promise<{ width: number | null; height: number | null; durationSeconds: number | null } | null> {
  return new Promise((resolve) => {
    const child = spawn(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const j = JSON.parse(out) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
        const s = j.streams?.[0];
        if (!s?.width || !s.height) return resolve(null);
        const d = Number(j.format?.duration);
        resolve({ width: s.width, height: s.height, durationSeconds: Number.isFinite(d) ? d : null });
      } catch {
        resolve(null);
      }
    });
  });
}

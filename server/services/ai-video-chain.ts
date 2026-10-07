import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { isTrustedProviderOutputUrl } from "@/lib/ai/character-replace/model";
import { recordJobEvent } from "@/lib/ai/job-events";
import { transitionJob } from "@/lib/ai/job-store";
import type { AiJobRow } from "@/lib/ai/jobs";
import { KLING_OMNI_VIDEO_PATH } from "@/lib/ai/kling/config";
import { klingCreateTask } from "@/lib/ai/kling/client";
import { KLING_OMNI_MODEL_NAME } from "@/lib/ai/kling/features/capabilities";
import { klingImageToVideo, type KlingImageToVideoInput } from "@/lib/ai/kling/features/image-to-video";
import { AI_SOURCE_BUCKET } from "@/lib/ai/storage";
import { signSourceUrl } from "@/lib/ai/storage-server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MediaProbe } from "@/lib/ai/ffmpeg-plan";
import { downloadToFile, probeMedia } from "@/server/services/ai-finalize-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE-MINUTE VIDEOS — four 15 s segments, chained on the worker (2026-10-06)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Omni makes at most 15 s and Kling refuses to extend an Omni video ("This
 * video not supported extend-video"). A minute is therefore four segments,
 * each opening on the previous segment's LAST frame (a `first_frame` — the
 * proven Image to Video path). The seam was generated and inspected the same
 * night: same person, place and light across the cut.
 *
 * Runs inside the generation finalizer (ai-character-replace-finalize-service)
 * for a job whose metadata carries `chain`:
 *   · not the last segment → take its last frame, submit the next segment from
 *     it, record this segment's Kling URL, and put the job back to
 *     `processing` under the new task id (the webhook finds it by that id);
 *   · the last segment → download the earlier segments from Kling (ingress is
 *     free on Railway — nothing intermediate is ever stored by us) and join
 *     the four into one file, which the finalizer then stores as usual.
 *
 * A failure anywhere is an ordinary finalize failure: the job fails and the
 * whole charge is refunded by the existing path.
 */

export interface VideoChain {
  segments: number;
  segmentSeconds: number;
  /** Kling output URLs of the finished segments, in order. */
  done: string[];
  /** Where Kling reports each segment — the same webhook the first one used. */
  callbackUrl: string;
}

export function readChain(metadata: unknown): VideoChain | null {
  const c = (metadata as { chain?: unknown } | null)?.chain as Partial<VideoChain> | undefined;
  if (!c || typeof c !== "object") return null;
  if (typeof c.segments !== "number" || c.segments < 2 || c.segments > 8) return null;
  if (typeof c.segmentSeconds !== "number" || typeof c.callbackUrl !== "string") return null;
  const done = Array.isArray(c.done) ? c.done.filter((u): u is string => typeof u === "string") : [];
  return { segments: c.segments, segmentSeconds: c.segmentSeconds, done, callbackUrl: c.callbackUrl };
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`))));
  });
}

/** The segment's last frame, as a JPEG the next segment opens on. */
async function lastFrame(videoFile: string, out: string): Promise<void> {
  await ffmpeg(["-sseof", "-0.1", "-i", videoFile, "-frames:v", "1", "-q:v", "2", out]);
}

/**
 * Continue the chain, or join it. Returns `{ continued: true }` when the next
 * segment was submitted (the caller stops), or the probe of the JOINED file
 * (the caller finalizes it as the result).
 */
export async function advanceOrJoinChain(opts: {
  job: AiJobRow;
  ownerId: string;
  chain: VideoChain;
  /** This segment, already downloaded and probed by the finalizer. */
  outputFile: string;
  providerOutputUrl: string;
  dir: string;
}): Promise<{ continued: true; note: string } | { continued: false; probe: MediaProbe }> {
  const { job, chain } = opts;
  const index = chain.done.length + 1; // 1-based: this segment

  if (index < chain.segments) {
    // the next segment opens on this one's last frame
    const framePath = path.join(opts.dir, `frame-${index}.jpg`);
    await lastFrame(opts.outputFile, framePath);
    const key = `${opts.ownerId}/video-chain/${job.id}-${index}.jpg`;
    const admin = createAdminClient();
    const up = await admin.storage.from(AI_SOURCE_BUCKET).upload(key, await readFile(framePath), { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error(`chain frame upload: ${up.error.message}`);
    const frameUrl = await signSourceUrl(key);

    const req = ((job.metadata as { request?: Record<string, unknown> } | null)?.request ?? {}) as Record<string, unknown>;
    const options = (req.options ?? {}) as Record<string, unknown>;
    const input: KlingImageToVideoInput = {
      firstFrameUrl: frameUrl,
      prompt: typeof req.prompt === "string" ? req.prompt : undefined,
      referenceImageUrls: Array.isArray(req.referenceImageUrls) ? (req.referenceImageUrls as string[]) : undefined,
      options: {
        durationSeconds: chain.segmentSeconds,
        ...(typeof options.resolution === "string" ? { resolution: options.resolution as "720p" | "1080p" } : {}),
        ...(typeof options.audio === "string" ? { audio: options.audio as "off" | "native" } : {}),
      },
    };
    const task = await klingCreateTask({
      model: KLING_OMNI_MODEL_NAME,
      path: `${KLING_OMNI_VIDEO_PATH}/${KLING_OMNI_MODEL_NAME}`,
      input: klingImageToVideo.buildRequest(input),
      callbackUrl: chain.callbackUrl,
      // unique per task: the first segment used the job id itself
      externalTaskId: `${job.id}:${index + 1}`,
      label: "one-minute segment",
      jobId: job.id,
    });

    const metadata = {
      ...((job.metadata as Record<string, unknown> | null) ?? {}),
      chain: { ...chain, done: [...chain.done, opts.providerOutputUrl] },
      provider_output_url: null,
    };
    // back to waiting on Kling, under the NEW task id — and a fresh finalize budget for it
    const moved = await transitionJob(job.id, ["finalizing"], "processing", {
      replicate_prediction_id: task.taskId,
      metadata,
      finalize_attempts: 0,
      finalize_lease_until: null,
      finalize_next_at: null,
      finalize_error: null,
    });
    if (!moved) throw new Error("chain: the job could not return to processing for its next segment");
    await recordJobEvent(job.id, "chain.segment", { segment: index, of: chain.segments, nextTask: task.taskId });
    return { continued: true, note: `segment ${index} of ${chain.segments} done; segment ${index + 1} submitted` };
  }

  // the last segment: fetch the earlier ones from Kling and join all of them
  const parts: string[] = [];
  for (const [i, url] of chain.done.entries()) {
    if (!isTrustedProviderOutputUrl(url)) throw new Error(`chain: segment ${i + 1} is not on a trusted host`);
    const file = path.join(opts.dir, `seg-${i + 1}.mp4`);
    await downloadToFile(url, file, 400 * 1024 * 1024);
    parts.push(file);
  }
  parts.push(opts.outputFile);
  const list = path.join(opts.dir, "concat.txt");
  await writeFile(list, parts.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
  const joined = path.join(opts.dir, "joined.mp4");
  try {
    // Kling's segments share codec, size and rate — a stream copy joins them losslessly
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", joined]);
  } catch {
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", joined]);
  }
  /*
    🔴 FIT THE STORAGE LIMIT (first live run, 2026-10-06). The joined minute
    was ~57 MB and the upload failed: "The object exceeded the maximum allowed
    size" — the project's per-file upload limit (Supabase default 50 MB; the
    results bucket sets none of its own). Over the budget, the minute is
    re-encoded to a bitrate that fits it (~6 Mbps for 60 s — sharp at 720p,
    fine at 1080p). Under it, the lossless stream-copy join is kept as is.
  */
  const { stat } = await import("node:fs/promises");
  const MAX_RESULT_BYTES = 45 * 1024 * 1024;
  if ((await stat(joined)).size > MAX_RESULT_BYTES) {
    const joinedProbe = await probeMedia(joined);
    const seconds = Math.max(1, joinedProbe?.durationSeconds ?? chain.segments * chain.segmentSeconds);
    const audioKbps = joinedProbe?.hasAudio ? 128 : 0;
    const videoKbps = Math.max(1500, Math.floor((MAX_RESULT_BYTES * 8 * 0.94) / seconds / 1000) - audioKbps);
    const fitted = path.join(opts.dir, "fitted.mp4");
    await ffmpeg([
      "-i", joined,
      "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${videoKbps}k`, "-maxrate", `${videoKbps}k`, "-bufsize", `${videoKbps * 2}k`, "-pix_fmt", "yuv420p",
      ...(joinedProbe?.hasAudio ? ["-c:a", "aac", "-b:a", `${audioKbps}k`] : ["-an"]),
      "-movflags", "+faststart", fitted,
    ]);
    await rename(fitted, joined);
    await recordJobEvent(job.id, "chain.joined", { fitted: true, videoKbps });
  }
  await rename(joined, opts.outputFile);
  const probe = await probeMedia(opts.outputFile);
  if (!probe?.hasVideo || !probe.durationSeconds) throw new Error("chain: the joined minute has no readable video");
  await recordJobEvent(job.id, "chain.joined", { segments: chain.segments, durationSeconds: probe.durationSeconds });
  return { continued: false, probe };
}

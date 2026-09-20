import "server-only";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readCharacterReplaceMeta } from "@/lib/ai/character-replace/job-meta";
import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import { AI_IMAGE_MAX_BYTES } from "@/lib/ai/media";
import { PREFLIGHT_VALIDATOR_VERSION, PREFLIGHT_VISION } from "@/lib/ai/preflight/config";
import { ambiguityTargets, decidePreflight, type PreflightMediaInput, type PreflightResult, type VisionJudgement } from "@/lib/ai/preflight/decision";
import type { FrameMeasurement } from "@/lib/ai/preflight/measure";
import { objectFingerprint } from "@/lib/ai/preflight/token";
import { recordJobEvent } from "@/lib/ai/job-events";
import { getJobAsService } from "@/lib/ai/job-store";
import { aiFeature } from "@/lib/ai/jobs";
import { AI_SOURCE_BUCKET, pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl, statSourceObject } from "@/lib/ai/storage-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectorsAvailable, measureImage, measureVideo, probeDims } from "@/server/preflight/detectors";
import { askVision } from "@/server/preflight/vision";
import { cleanupFinalizationFiles, downloadToFile } from "@/server/services/ai-finalize-service";
import { spawn } from "node:child_process";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREFLIGHT — the worker's run: download, measure, judge, remember
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Called by /api/internal/ai/preflight on the worker for a job that is still
 * `queued` (created, uploaded, NOT started — nothing reserved, nothing at a
 * provider). The record it writes on the job row is what Start trusts
 * (brief §12–§13):
 *
 *   metadata.preflight = {
 *     version, mode, checkedAt, durationMs,
 *     media: { reference: "size:etag", video: "size:etag" },   ← the fingerprints Start re-checks
 *     hashes: { reference, video },                             ← sha256 of the bytes, for reuse
 *     result: PreflightResult,                                  ← the structured verdict (brief §8)
 *     measurements: { image, frames },                          ← what the detectors saw, for tuning and reuse
 *   }
 *
 * Layers (brief §19): the fast checks (readable? big enough?) are inside the
 * measurers; the computer-vision layer is server/preflight/detectors.ts; the
 * vision model is asked only for the ambiguous band; the decision is
 * lib/ai/preflight/decision.ts. A run that cannot happen (models missing,
 * a download refused) answers `validator_unavailable` — never a pass.
 *
 * Reuse (brief §14, §24): the same bytes (sha256) + the same mode + the same
 * validator version, seen for this member in the last week, are not
 * measured again — the stored measurements are re-judged. Never across
 * members, never by a hash a browser claimed: the worker hashes what it
 * downloaded.
 */

export interface PreflightRecord {
  version: number;
  mode: ReplacementMode;
  checkedAt: string;
  durationMs: number;
  media: { reference: string; video: string };
  hashes: { reference: string; video: string } | null;
  result: PreflightResult;
  measurements: { image: FrameMeasurement | null; frames: FrameMeasurement[]; video: { width: number; height: number; durationMs: number } | null } | null;
}

export type PreflightRunOutcome = { ok: true; record: PreflightRecord } | { ok: false; code: "JOB_NOT_FOUND" | "NOT_QUEUED" | "NO_META"; detail: string };

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

async function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

/** A previous run over the same bytes, for this member, this mode, this validator. */
async function findReusable(userId: string, mode: ReplacementMode, hashes: { reference: string; video: string }): Promise<PreflightRecord | null> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await createAdminClient()
      .from("ai_jobs")
      .select("id, metadata")
      .eq("user_id", userId)
      .eq("feature", "ai_character_replace")
      .gte("created_at", since)
      .filter("metadata->preflight->hashes->>video", "eq", hashes.video)
      .filter("metadata->preflight->hashes->>reference", "eq", hashes.reference)
      .order("created_at", { ascending: false })
      .limit(3);
    for (const row of data ?? []) {
      const p = (row.metadata as { preflight?: PreflightRecord } | null)?.preflight;
      if (p && p.version === PREFLIGHT_VALIDATOR_VERSION && p.mode === mode && p.measurements && !p.result.errors.includes("validator_unavailable")) return p;
    }
  } catch (e) {
    console.warn("[preflight] reuse lookup failed", { error: String(e).slice(0, 160) });
  }
  return null;
}

/** Two sampled frames as small JPEGs beside the job's other objects, signed for the vision model. */
async function frameUrlsForVision(file: string, durationMs: number, userId: string, jobId: string, positions: number[]): Promise<string[]> {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return [];
  const admin = createAdminClient();
  const urls: string[] = [];
  for (const [i, p] of positions.entries()) {
    const seek = ((durationMs / 1000) * p).toFixed(3);
    const jpeg = await new Promise<Buffer | null>((resolve) => {
      const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-ss", seek, "-i", file, "-frames:v", "1", "-vf", "scale=768:768:force_original_aspect_ratio=decrease:flags=area", "-f", "image2", "-vcodec", "mjpeg", "-q:v", "6", "-"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (d: Buffer) => chunks.push(d));
      child.on("error", () => resolve(null));
      child.on("close", (code) => resolve(code === 0 ? Buffer.concat(chunks) : null));
    });
    if (!jpeg || jpeg.length < 1024) continue;
    const key = `${userId}/${feature.id}/${jobId}/preflight-frame-${i}.jpg`;
    if (!pathBelongsTo(key, userId, jobId)) continue;
    const up = await admin.storage.from(AI_SOURCE_BUCKET).upload(key, jpeg, { contentType: "image/jpeg", upsert: true });
    if (up.error) continue;
    try {
      urls.push(await signSourceUrl(key));
    } catch {
      /* an unsigned frame is simply not shown */
    }
  }
  return urls;
}

export async function runCharacterReplacePreflight(jobId: string): Promise<PreflightRunOutcome> {
  const startedAt = Date.now();
  const job = await getJobAsService(jobId);
  if (!job || job.feature !== "ai_character_replace" || !job.user_id) return { ok: false, code: "JOB_NOT_FOUND", detail: "no such job" };
  if (job.status !== "queued") return { ok: false, code: "NOT_QUEUED", detail: `job is ${job.status}` };
  const meta = readCharacterReplaceMeta(job.metadata);
  if (!meta) return { ok: false, code: "NO_META", detail: "job has no contract metadata" };
  const userId = job.user_id;
  const mode = meta.mode;
  const dir = path.join(tmpdir(), "frenz-ai-preflight", jobId.replace(/[^0-9a-fA-F-]/g, ""));

  const finish = async (record: PreflightRecord): Promise<PreflightRunOutcome> => {
    record.durationMs = Date.now() - startedAt;
    const fresh = await getJobAsService(jobId);
    await createAdminClient()
      .from("ai_jobs")
      .update({ metadata: { ...(fresh?.metadata ?? job.metadata ?? {}), preflight: record } })
      .eq("id", jobId)
      .eq("status", "queued");
    // brief §26: the numbers that let the thresholds be tuned — never the media
    await recordJobEvent(jobId, "preflight.completed", {
      mode,
      valid: record.result.valid,
      errors: record.result.errors,
      warnings: record.result.warnings,
      ambiguous: record.result.ambiguous,
      visionUsed: record.result.visionUsed,
      faceConfidence: record.result.referenceImage.faceConfidence,
      referenceBodyVisibility: record.result.referenceImage.bodyVisibility,
      referenceFaceHeightFrac: record.result.referenceImage.faceHeightFrac,
      videoUsableFrames: record.result.video.usableFrames,
      videoSampledFrames: record.result.video.sampledFrames,
      videoBodyVisibility: record.result.video.bodyVisibility,
      durationMs: record.durationMs,
    });
    console.info("[preflight] done", { jobId, mode, valid: record.result.valid, errors: record.result.errors, ms: record.durationMs, visionUsed: record.result.visionUsed });
    return { ok: true, record };
  };

  const unavailable = async (detail: string): Promise<PreflightRunOutcome> => {
    console.error("[preflight] unavailable", { jobId, detail: detail.slice(0, 300) });
    const result: PreflightResult = {
      valid: false,
      mode,
      referenceImage: { valid: false, faceDetected: false, faceConfidence: null, faceVisibility: null, bodyVisibility: null, faceHeightFrac: null, sharpness: null },
      video: { valid: false, usableFrames: 0, sampledFrames: 0, faceVisibility: null, bodyVisibility: null, faceHeightFrac: null },
      compatibility: { valid: false, confidence: null },
      errors: ["validator_unavailable"],
      warnings: [],
      ambiguous: false,
      visionUsed: false,
    };
    return finish({ version: PREFLIGHT_VALIDATOR_VERSION, mode, checkedAt: new Date().toISOString(), durationMs: 0, media: { reference: "-", video: "-" }, hashes: null, result, measurements: null });
  };

  try {
    // ownership of every path, from the row, before any becomes a URL
    for (const p of [meta.video.path, meta.character.path]) if (!pathBelongsTo(p, userId, jobId)) return unavailable("a media path failed ownership");
    if (!(await detectorsAvailable())) return unavailable("detectors are not available on this worker");

    const [videoObject, referenceObject] = await Promise.all([statSourceObject(meta.video.path), statSourceObject(meta.character.path)]);
    if (!videoObject || !referenceObject) return unavailable("an upload is missing from the bucket");
    const media = { reference: objectFingerprint(referenceObject), video: objectFingerprint(videoObject) };

    await mkdir(dir, { recursive: true });
    const videoFile = path.join(dir, "video.bin");
    const imageFile = path.join(dir, "reference.bin");
    const [videoUrl, imageUrl] = await Promise.all([signSourceUrl(meta.video.path), signSourceUrl(meta.character.path)]);
    await Promise.all([downloadToFile(videoUrl, videoFile, MAX_VIDEO_BYTES), downloadToFile(imageUrl, imageFile, AI_IMAGE_MAX_BYTES)]);
    const [videoHash, referenceHash] = await Promise.all([sha256File(videoFile), sha256File(imageFile)]);
    const hashes = { reference: referenceHash, video: videoHash };

    /* ── reuse: the same bytes, mode and validator, seen for this member ── */
    const previous = await findReusable(userId, mode, hashes);
    let input: PreflightMediaInput;
    if (previous?.measurements) {
      input = { image: previous.measurements.image, frames: previous.measurements.frames, video: previous.measurements.video, vision: null };
      console.info("[preflight] reusing measurements", { jobId, mode });
    } else {
      /* ── measure: the photo and six frames, in parallel ─────────────── */
      const [image, video] = await Promise.all([measureImage(imageFile), measureVideo(videoFile)]);
      input = { image, frames: video?.frames ?? [], video: video ? { width: video.dims.width, height: video.dims.height, durationMs: video.dims.durationMs ?? 0 } : null, vision: null };
    }

    /* ── the ambiguous band: ask the vision layer, then decide ───────── */
    const targets = ambiguityTargets(input, mode);
    if (targets.length && PREFLIGHT_VISION.enabled) {
      const vision: { reference: VisionJudgement | null; video: VisionJudgement | null } = { reference: null, video: null };
      const videoDims = input.video ?? (await probeDims(videoFile));
      await Promise.all(
        targets.map(async (t) => {
          if (t === "reference") vision.reference = await askVision({ mode, target: "reference", imageUrls: [imageUrl] });
          else if (videoDims?.durationMs) vision.video = await askVision({ mode, target: "video", imageUrls: await frameUrlsForVision(videoFile, videoDims.durationMs, userId, jobId, [0.3, 0.7]) });
        }),
      );
      input = { ...input, vision };
    }
    const result = decidePreflight(input, mode);
    return finish({
      version: PREFLIGHT_VALIDATOR_VERSION,
      mode,
      checkedAt: new Date().toISOString(),
      durationMs: 0,
      media,
      hashes,
      result,
      measurements: { image: input.image, frames: [...input.frames], video: input.video },
    });
  } catch (e) {
    return unavailable(String(e));
  } finally {
    await cleanupFinalizationFiles(dir);
  }
}

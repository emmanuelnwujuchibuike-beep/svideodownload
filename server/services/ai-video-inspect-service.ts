import "server-only";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DetectedPerson } from "@/lib/ai/kling/features/person-replace-prompt";
import { KLING_OMNI } from "@/lib/ai/kling/features/capabilities";
import type { KlingVideoFacts } from "@/lib/ai/kling/features/shared";
import type { PersonDetection } from "@/lib/ai/preflight/measure";
import { AI_SOURCE_BUCKET } from "@/lib/ai/storage";
import { signSourceUrl, statSourceObject } from "@/lib/ai/storage-server";
import { objectFingerprint } from "@/lib/ai/preflight/token";
import { chooseInspectionFrame, parseFfprobe, peopleCountsVary, PEOPLE_SAMPLE_POSITIONS, type SampledFrame } from "@/lib/ai/video/people-detect";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectorsAvailable, detectPeopleAt, renderFrameJpeg } from "@/server/preflight/detectors";
import { cleanupFinalizationFiles, downloadToFile } from "@/server/services/ai-finalize-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  INSPECTING A REFERENCE VIDEO — on the WORKER, where ffprobe and the models are
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two depths, one entry point (called by /api/internal/ai/video-inspect):
 *
 *   detect: false   the FACTS only — frame size (rotation applied), frame rate,
 *                   length, container, sound. ffprobe reads the signed URL
 *                   directly: a few range requests for the header, never the
 *                   whole file. Runs when any reference video finishes uploading.
 *   detect: true    the facts AND who is in it — the clip is downloaded once
 *                   (worker ingress), three moments are run through the
 *                   existing YOLOX-nano person detector, and the frame with the
 *                   most people is saved as a small JPEG beside the video for
 *                   the member to tap on. Runs when the member opens
 *                   Replace characters.
 *
 * Nothing here signs, prices or charges: the frontend turns the answer into a
 * signed inspection token (lib/ai/video/inspection-token.ts). Every path is
 * checked against its owner before a byte is read.
 */

export interface VideoInspectRequest {
  userId: string;
  path: string;
  detect: boolean;
}

export type VideoInspectOutcome =
  | {
      ok: true;
      fingerprint: string;
      facts: KlingVideoFacts;
      hasAudio: boolean;
      people?: DetectedPerson[];
      frame?: { path: string; positionMs: number };
      /** People enter or leave between the sampled moments. */
      countsVary?: boolean;
    }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "TOO_LARGE" | "UNREADABLE" | "DETECTORS_UNAVAILABLE"; detail: string };

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const PROBE_TIMEOUT_MS = 25_000;

/** `<userId>/video-reference/<uuid>.<mp4|mov>` — exactly what /api/ai/video/reference mints, and nothing else. */
export function ownsReferenceVideo(userId: string, objectPath: string): boolean {
  if (!/^[0-9a-fA-F-]{36}$/.test(userId)) return false;
  return new RegExp(`^${userId}/video-reference/[0-9a-fA-F-]{36}\\.(mp4|mov)$`).test(objectPath);
}

function ffprobe(input: string): Promise<unknown | null> {
  return new Promise((resolve) => {
    const args = ["-v", "error", ...(input.startsWith("https://") ? ["-rw_timeout", "15000000"] : []), "-show_entries", "stream=codec_type,width,height,avg_frame_rate,r_frame_rate:stream_tags=rotate:stream_side_data=rotation:format=duration,format_name", "-of", "json", input];
    const child = spawn(FFPROBE, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), PROBE_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.length > 256 * 1024) child.kill("SIGKILL");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(null);
      }
    });
  });
}

export async function inspectReferenceVideo(req: VideoInspectRequest): Promise<VideoInspectOutcome> {
  if (!ownsReferenceVideo(req.userId, req.path)) return { ok: false, code: "FORBIDDEN", detail: "path is not this member's reference video" };
  const stored = await statSourceObject(req.path).catch(() => null);
  if (!stored || stored.size <= 0) return { ok: false, code: "NOT_FOUND", detail: "no such object" };
  if (stored.size > KLING_OMNI.video.maxBytes) return { ok: false, code: "TOO_LARGE", detail: `${stored.size} bytes` };
  const url = await signSourceUrl(req.path);
  const fingerprint = objectFingerprint(stored);

  if (!req.detect) {
    const probed = parseFfprobe(await ffprobe(url));
    if (!probed) return { ok: false, code: "UNREADABLE", detail: "ffprobe found no video stream" };
    return { ok: true, fingerprint, facts: { ...probed.facts, sizeBytes: stored.size }, hasAudio: probed.hasAudio };
  }

  if (!(await detectorsAvailable())) return { ok: false, code: "DETECTORS_UNAVAILABLE", detail: "the person model could not be loaded on this worker" };
  const dir = path.join(tmpdir(), "frenz-ai-inspect", randomUUID());
  const file = path.join(dir, req.path.endsWith(".mov") ? "source.mov" : "source.mp4");
  try {
    await mkdir(dir, { recursive: true });
    await downloadToFile(url, file, KLING_OMNI.video.maxBytes);
    const probed = parseFfprobe(await ffprobe(file));
    if (!probed || !probed.facts.durationMs) return { ok: false, code: "UNREADABLE", detail: "ffprobe found no video stream or no duration" };
    const { width, height, durationMs } = probed.facts;

    // one moment at a time: the decode and the model are the worker's heaviest work, and three is plenty
    const frames: SampledFrame[] = [];
    for (const p of PEOPLE_SAMPLE_POSITIONS) {
      const positionMs = Math.round(durationMs * p);
      const people: PersonDetection[] = await detectPeopleAt(file, { width, height }, positionMs / 1000).catch((e) => {
        console.warn("[ai/inspect] frame skipped", { position: p, error: String(e).slice(0, 160) });
        return [];
      });
      frames.push({ positionMs, width, height, people });
    }
    const chosen = chooseInspectionFrame(frames);
    if (!chosen) return { ok: false, code: "UNREADABLE", detail: "no frame could be decoded" };

    const jpeg = await renderFrameJpeg(file, chosen.frame.positionMs / 1000);
    const framePath = req.path.replace(/\.(mp4|mov)$/, ".frame.jpg");
    const up = await createAdminClient().storage.from(AI_SOURCE_BUCKET).upload(framePath, jpeg, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error(`frame upload: ${up.error.message}`);

    return {
      ok: true,
      fingerprint,
      facts: { ...probed.facts, sizeBytes: stored.size },
      hasAudio: probed.hasAudio,
      people: chosen.people,
      frame: { path: framePath, positionMs: chosen.frame.positionMs },
      countsVary: peopleCountsVary(frames),
    };
  } catch (e) {
    console.error("[ai/inspect] failed", { path: req.path, error: String(e).slice(0, 300) });
    return { ok: false, code: "UNREADABLE", detail: String(e).slice(0, 300) };
  } finally {
    await cleanupFinalizationFiles(dir);
  }
}

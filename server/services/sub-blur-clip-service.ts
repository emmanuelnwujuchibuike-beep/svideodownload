import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hasPrivateR2, hasR2, presignPrivateGet, putR2 } from "@/lib/storage/r2";
import { BLUR_CLIP_MAX_BYTES, buildBlurClipArgs } from "@/lib/sub/blur-clip-plan";
import { ensureBlurPreview, lockedPostsNeedingStills, lockedVideosNeedingClips, saveServerBlurClip } from "@/lib/sub/blur-preview";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
/** Four seconds at 24 px is trivial work; past this the source is unreachable or broken, and the item is skipped. */
const CLIP_TIMEOUT_MS = 90_000;
/** One run's ceiling, so a large backlog is worked through over a few kicks rather than one endless job. */
const MAX_CLIPS_PER_RUN = 40;
const MAX_STILLS_PER_RUN = 20;
/** An item that failed is left alone this long (a broken file must not hold the head of the queue on every kick). */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

let running = false;
const failedAt = new Map<string, number>();

/**
 * WORKER ONLY — makes the blurred clip every locked video still lacks, and the blurred still every locked post lacks
 * (owner, 2026-10-29: "the 18+ and all exclusive should auto play … blurred on unsubscriber, nothing less than that").
 *
 * The private file is read through a five-minute link, and ffmpeg reads only its first seconds; the 24 px clip it writes
 * (lib/sub/blur-clip-plan.ts) is the only thing stored, on the public media host, exactly like the clip a creator's
 * browser uploads. One run at a time per worker; the outcome lands on the rows, which the feed reads.
 */
export async function runSubBlurClips(): Promise<{ clips: number; stillsTried: number; failed: number; skipped?: string }> {
  if (running) return { clips: 0, stillsTried: 0, failed: 0, skipped: "already running" };
  if (!hasR2 || !hasPrivateR2) return { clips: 0, stillsTried: 0, failed: 0, skipped: "storage not configured" };
  running = true;
  let clips = 0;
  let stillsTried = 0;
  let failed = 0;
  try {
    const now = Date.now();
    const todo = (await lockedVideosNeedingClips(MAX_CLIPS_PER_RUN * 2).catch(() => []))
      .filter((t) => now - (failedAt.get(`${t.postId}:${t.idx}`) ?? 0) > RETRY_AFTER_MS)
      .slice(0, MAX_CLIPS_PER_RUN);
    for (const t of todo) {
      const id = `${t.postId}:${t.idx}`;
      const dir = await mkdtemp(join(tmpdir(), "sub-blur-"));
      try {
        const out = join(dir, "clip.mp4");
        await run(FFMPEG, buildBlurClipArgs(await presignPrivateGet(t.key, 300), out), CLIP_TIMEOUT_MS);
        const bytes = await readFile(out);
        if (!bytes.byteLength || bytes.byteLength > BLUR_CLIP_MAX_BYTES) throw new Error("not a blur clip");
        const url = await putR2(`sub-blur/${t.postId}/${t.idx}-${Date.now().toString(36)}.mp4`, new Uint8Array(bytes), "video/mp4");
        if (!(await saveServerBlurClip(t.postId, t.idx, url))) throw new Error("slot already filled");
        clips++;
        failedAt.delete(id);
      } catch {
        failed++;
        failedAt.set(id, Date.now());
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
    // the blurred still a photo slide shows (and a video's poster) — sharp, from each item's thumb or photo
    const stillTodo = (await lockedPostsNeedingStills(MAX_STILLS_PER_RUN * 10).catch(() => []))
      .filter((postId) => now - (failedAt.get(postId) ?? 0) > RETRY_AFTER_MS)
      .slice(0, MAX_STILLS_PER_RUN);
    for (const postId of stillTodo) {
      await ensureBlurPreview(postId);
      stillsTried++;
      // ensureBlurPreview is best effort and silent: a post it could not fill waits like a failed clip
      failedAt.set(postId, Date.now());
    }
  } finally {
    running = false;
  }
  return { clips, stillsTried, failed };
}

/** Runs a binary with a hard timeout; rejects on a non-zero exit. Output is discarded (`-loglevel error`). */
function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 2000) stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timed out"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deleteR2, hasPrivateR2, hasR2, presignPrivateGet, putR2, r2KeyOfPublicUrl } from "@/lib/storage/r2";
import { BLUR_CLIP_MAX_BYTES, blurClipKey, buildBlurClipArgs } from "@/lib/sub/blur-clip-plan";
import { blurClipSlotOpen, ensureBlurPreview, lockedPostsNeedingStills, lockedVideosNeedingClips, saveServerBlurClip } from "@/lib/sub/blur-preview";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
/** Four seconds at 24 px is trivial work; past this the source is unreachable or broken, and the item is skipped. */
const CLIP_TIMEOUT_MS = 90_000;
/** One run's ceiling, so a large backlog is worked through over a few kicks rather than one endless job. */
const MAX_CLIPS_PER_RUN = 40;
const MAX_STILLS_PER_RUN = 20;
/** An item that failed is left alone this long (a broken file must not hold the head of the queue on every kick). */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

let running = false;
/** item (`post:idx`) or post id → when it last failed (or, for a still, was last tried). Pruned on every run. */
const failedAt = new Map<string, number>();

/**
 * Forget every entry older than the retry window (code review, 2026-10-30): the map gained an entry per item and per
 * post tried — successes included — and nothing removed them, so the long-lived worker grew with the catalogue. An
 * expired entry no longer holds anything back, so dropping it changes no decision.
 */
export function pruneFailedAt(map: Map<string, number>, now: number, windowMs: number = RETRY_AFTER_MS): void {
  for (const [id, at] of map) if (now - at > windowMs) map.delete(id);
}

/**
 * WORKER ONLY — makes the blurred clip every locked video still lacks, and the blurred still every locked post lacks
 * (owner, 2026-10-29: "the 18+ and all exclusive should auto play … blurred on unsubscriber, nothing less than that").
 *
 * The private file is read through a five-minute link, and ffmpeg reads only its first seconds; the 24 px clip it writes
 * (lib/sub/blur-clip-plan.ts) is the only thing stored, on the public media host, exactly like the clip a creator's
 * browser uploads. One run at a time per worker; the outcome lands on the rows, which the feed reads.
 */
export async function runSubBlurClips(): Promise<{ clips: number; stillsTried: number; failed: number; alreadyFilled: number; skipped?: string }> {
  if (running) return { clips: 0, stillsTried: 0, failed: 0, alreadyFilled: 0, skipped: "already running" };
  if (!hasR2 || !hasPrivateR2) return { clips: 0, stillsTried: 0, failed: 0, alreadyFilled: 0, skipped: "storage not configured" };
  running = true;
  let clips = 0;
  let stillsTried = 0;
  let failed = 0;
  // filled by the creator's own browser while this run worked — not a failure, and nothing is left behind
  let alreadyFilled = 0;
  try {
    const now = Date.now();
    pruneFailedAt(failedAt, now);
    const todo = (await lockedVideosNeedingClips(MAX_CLIPS_PER_RUN * 2).catch(() => []))
      .filter((t) => now - (failedAt.get(`${t.postId}:${t.idx}`) ?? 0) > RETRY_AFTER_MS)
      .slice(0, MAX_CLIPS_PER_RUN);
    for (const t of todo) {
      const id = `${t.postId}:${t.idx}`;
      // still waiting? A browser may have stored its MP4 since the list was read: then nothing to make or upload
      if (!(await blurClipSlotOpen(t.postId, t.idx))) {
        alreadyFilled++;
        failedAt.delete(id);
        continue;
      }
      const dir = await mkdtemp(join(tmpdir(), "sub-blur-"));
      try {
        const out = join(dir, "clip.mp4");
        // at the size the post's blur level stores (0307 — 24 px unless the creator chose Light)
        await run(FFMPEG, buildBlurClipArgs(await presignPrivateGet(t.key, 300), out, t.width), CLIP_TIMEOUT_MS);
        const bytes = await readFile(out);
        if (!bytes.byteLength || bytes.byteLength > BLUR_CLIP_MAX_BYTES) throw new Error("not a blur clip");
        const key = blurClipKey(t.postId, t.idx, Date.now().toString(36));
        const url = await putR2(key, new Uint8Array(bytes), "video/mp4");
        if (await saveServerBlurClip(t.postId, t.idx, url)) {
          clips++;
          // the older recipe's clip it replaced is no longer referenced — never left in the public bucket
          const oldKey = r2KeyOfPublicUrl(t.oldClip);
          if (oldKey && oldKey !== key) await deleteR2(oldKey).catch(() => false);
        } else {
          // not stored, so our copy is removed — never orphaned in the public bucket (code review, 2026-10-30)
          await deleteR2(key).catch(() => false);
          // still empty → the save itself failed (a database error): a real failure, which waits out the retry window
          if (await blurClipSlotOpen(t.postId, t.idx)) throw new Error("save refused");
          // filled in the seconds ffmpeg ran: not a failure, nothing held back
          alreadyFilled++;
        }
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
  return { clips, stillsTried, failed, alreadyFilled };
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

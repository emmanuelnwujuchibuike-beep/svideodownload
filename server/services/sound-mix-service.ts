import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bustHomeFeedCache } from "@/lib/social/home-feed";
import { failSoundMix, finishSoundMix, pendingSoundMixes } from "@/lib/social/sound-mix";
import { buildSoundMixArgs, soundMixKey } from "@/lib/social/sound-mix-plan";
import { deleteR2, hasR2, putR2 } from "@/lib/storage/r2";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
/** The picture is copied, only the audio is encoded: a reel takes seconds. Past this the source is unreachable. */
const MIX_TIMEOUT_MS = 180_000;
/** One run's ceiling; the next publish's kick carries on. */
const MAX_MIXES_PER_RUN = 20;
/** Tries before a reel is given up on (it then keeps its own audio). */
export const MAX_MIX_ATTEMPTS = 3;
/** A reel that failed waits this long before its next try. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

let running = false;
/** post id → its failures so far and when the last one was. Entries leave on success or when the reel is given up. */
const failures = new Map<string, { n: number; at: number }>();

/**
 * WORKER ONLY — gives every reel made with "Use this sound" that sound as its audio (0308 — owner, 2026-10-30: the
 * sound replaces the reel's own audio). For each reel waiting: ffmpeg copies the picture and lays the sound under it
 * (lib/social/sound-mix-plan.ts), the result is stored under a new key on the public media host, and the reel is
 * pointed at it. The uploaded original stays where it was (it is the post's source_url). Reels published while a run
 * works are picked up by the same run: it reads the queue again until it is empty or the ceiling is reached.
 */
export async function runSoundMixes(): Promise<{ mixed: number; failed: number; gaveUp: number; skipped?: string }> {
  if (running) return { mixed: 0, failed: 0, gaveUp: 0, skipped: "already running" };
  if (!hasR2) return { mixed: 0, failed: 0, gaveUp: 0, skipped: "storage not configured" };
  running = true;
  let mixed = 0;
  let failed = 0;
  let gaveUp = 0;
  const seen = new Set<string>();
  try {
    while (mixed + failed < MAX_MIXES_PER_RUN) {
      const now = Date.now();
      const todo = (await pendingSoundMixes(MAX_MIXES_PER_RUN)).filter((t) => !seen.has(t.postId) && now - (failures.get(t.postId)?.at ?? 0) > RETRY_AFTER_MS);
      if (!todo.length) break;
      for (const t of todo) {
        seen.add(t.postId);
        const dir = await mkdtemp(join(tmpdir(), "sound-mix-"));
        try {
          const out = join(dir, "reel.mp4");
          await run(FFMPEG, buildSoundMixArgs(t.videoUrl, t.soundUrl, out), MIX_TIMEOUT_MS);
          const bytes = await readFile(out);
          if (!bytes.byteLength) throw new Error("empty output");
          const key = soundMixKey(t.postId, Date.now().toString(36));
          const url = await putR2(key, new Uint8Array(bytes), "video/mp4");
          if (await finishSoundMix(t.postId, url)) {
            mixed++;
            failures.delete(t.postId);
            await bustHomeFeedCache(t.publisherId).catch(() => {});
          } else {
            // no longer pending (deleted, or done by another run): our copy is not referenced — never orphaned
            await deleteR2(key).catch(() => false);
          }
        } catch (e) {
          failed++;
          const n = (failures.get(t.postId)?.n ?? 0) + 1;
          if (n >= MAX_MIX_ATTEMPTS) {
            failures.delete(t.postId);
            await failSoundMix(t.postId);
            gaveUp++;
          } else failures.set(t.postId, { n, at: Date.now() });
          console.warn("[sounds/mix] failed", { postId: t.postId, attempt: n, reason: e instanceof Error ? e.message.slice(0, 200) : "error" });
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
  } finally {
    running = false;
  }
  return { mixed, failed, gaveUp };
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

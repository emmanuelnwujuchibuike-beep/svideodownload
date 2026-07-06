import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

export interface DownloadResult {
  stream: ReadableStream<Uint8Array>;
  ext: string;
  contentType: string;
  /** Exact size of the prepared file in bytes (for Content-Length). */
  filesize: number;
}

/**
 * Disk-backed download cache with in-flight request coalescing.
 *
 * Why this matters at scale: when a video trends, thousands of users request
 * the SAME url+format. Without coalescing, each spawns its own yt-dlp+ffmpeg
 * run. Here the first request produces the file (paying the full cost once) and
 * every concurrent or subsequent request for the same key is served straight
 * from disk in milliseconds — turning "processing time" to ~0 for popular
 * content and shedding enormous load off the box.
 *
 * Cached files are shared across readers and evicted by TTL + a total-size cap,
 * NOT on stream close. When caching is disabled the producer writes to a temp
 * file that is removed once its single stream is consumed (legacy behaviour).
 */

const ENABLED = !["false", "0", "off"].includes(
  (process.env.DOWNLOAD_CACHE_ENABLED || "true").toLowerCase(),
);
const CACHE_DIR = process.env.DOWNLOAD_CACHE_DIR || join(tmpdir(), "svd-cache");
const TTL_MS = Number(process.env.DOWNLOAD_CACHE_TTL_MS || 600_000); // 10 min
const MAX_BYTES = Number(
  process.env.DOWNLOAD_CACHE_MAX_BYTES || 2_000_000_000, // 2 GB
);

interface Produced {
  filePath: string;
  size: number;
}

/** Producer writes the finished media to `finalPath` (and nothing else). */
export type Producer = (finalPath: string) => Promise<void>;

const inflight = new Map<string, Promise<Produced>>();

function cachePathFor(key: string, ext: string): string {
  return join(CACHE_DIR, `${key}.${ext}`);
}

async function isFresh(path: string): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(path);
    return Date.now() - mtimeMs < TTL_MS;
  } catch {
    return false;
  }
}

function toResult(
  filePath: string,
  ext: string,
  contentType: string,
  size: number,
  cleanupOnClose: boolean,
): DownloadResult {
  const nodeStream = createReadStream(filePath);
  if (cleanupOnClose) {
    const cleanup = () => void rm(filePath, { force: true });
    nodeStream.once("close", cleanup);
    nodeStream.once("error", cleanup);
  }
  return {
    stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
    ext,
    contentType,
    filesize: size,
  };
}

/** Best-effort eviction: drop expired files, then enforce the size cap. */
let sweeping = false;
async function sweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const names = await readdir(CACHE_DIR).catch(() => [] as string[]);
    const now = Date.now();
    const files: { path: string; size: number; mtimeMs: number }[] = [];
    for (const name of names) {
      const path = join(CACHE_DIR, name);
      try {
        const s = await stat(path);
        if (now - s.mtimeMs >= TTL_MS) {
          await rm(path, { force: true });
        } else {
          files.push({ path, size: s.size, mtimeMs: s.mtimeMs });
        }
      } catch {
        /* file vanished mid-sweep; ignore */
      }
    }
    let total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_BYTES) {
      files.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
      for (const f of files) {
        if (total <= MAX_BYTES) break;
        await rm(f.path, { force: true }).catch(() => {});
        total -= f.size;
      }
    }
  } finally {
    sweeping = false;
  }
}

/**
 * Returns a stream for (key, ext) — from cache if fresh, by coalescing onto an
 * in-flight production, or by invoking `producer` exactly once.
 */
export async function getOrProduce(
  key: string,
  ext: string,
  contentType: string,
  producer: Producer,
): Promise<DownloadResult> {
  if (!ENABLED) {
    // Cache off: produce to a unique temp file, delete after it is streamed.
    const tmpPath = join(tmpdir(), `svd-${key}-${Date.now()}.${ext}`);
    await producer(tmpPath);
    const { size } = await stat(tmpPath);
    return toResult(tmpPath, ext, contentType, size, true);
  }

  await mkdir(CACHE_DIR, { recursive: true });

  // Synchronous get/set (no await between) keeps coalescing race-free.
  // Files smaller than this are treated as corrupt/partial (never cached/served).
  // A broken ffmpeg invocation (bad filter syntax, failed probe, etc.) can
  // still emit a minimal-but-nonzero MP4 container before erroring out — well
  // under 10KB in practice — so the floor needs to be well above "nonzero",
  // not just above it.
  const MIN_BYTES = 10_240;

  let work = inflight.get(key);
  if (!work) {
    const finalPath = cachePathFor(key, ext);
    work = (async () => {
      if (await isFresh(finalPath)) {
        const { size } = await stat(finalPath);
        if (size >= MIN_BYTES) return { filePath: finalPath, size };
        await rm(finalPath, { force: true }); // drop a stale/corrupt cached file
      }
      try {
        await producer(finalPath);
      } catch (err) {
        // A failed/interrupted producer can leave a partial file — remove it so
        // we never serve or cache a blank/corrupt download.
        await rm(finalPath, { force: true });
        throw err;
      }
      const { size } = await stat(finalPath).catch(() => ({ size: 0 }));
      if (size < MIN_BYTES) {
        await rm(finalPath, { force: true });
        throw new Error("produced file is empty or too small");
      }
      return { filePath: finalPath, size };
    })();
    inflight.set(key, work);
    void work.finally(() => inflight.delete(key));
  }

  const { filePath, size } = await work;
  void sweep();
  return toResult(filePath, ext, contentType, size, false);
}

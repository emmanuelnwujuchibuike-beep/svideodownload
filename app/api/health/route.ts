import { NextResponse } from "next/server";

import { cacheBackend, cacheGet, cacheSet } from "@/lib/cache";
import { downloadConcurrencyStats } from "@/lib/concurrency";
import { checkStream } from "@/lib/media/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness + a real cache round-trip. `cacheBackend` only says whether Upstash is
 * *configured*; the probe below actually writes then reads a key and times it, so
 * `cache.live` proves Redis is reachable and `cache.latencyMs` shows how fast.
 */
export async function GET() {
  const probeKey = `health:probe:${Date.now()}`;
  const token = Math.random().toString(36).slice(2);
  let live = false;
  let latencyMs: number | null = null;
  let error: string | null = null;

  try {
    const started = performance.now();
    // Store an OBJECT (exactly how the app caches everything) so the round-trip
    // matches real usage — a bare string doesn't survive Upstash's automatic
    // JSON (de)serialization and would give a false negative.
    await cacheSet(probeKey, { t: token }, 30);
    const read = await cacheGet<{ t: string }>(probeKey);
    latencyMs = Math.round(performance.now() - started);
    live = read?.t === token; // round-trip actually persisted + returned our value
    if (!live) {
      // Distinguish the two failure modes so the fix is obvious. cacheSet swallows
      // write errors, so a missing read usually means the write was rejected —
      // classically an Upstash READ-ONLY token (use the read-write one).
      error =
        read == null
          ? "write did not persist — check UPSTASH_REDIS_REST_TOKEN is the read-WRITE token, not read-only"
          : "value mismatch on read-back";
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "cache probe failed";
  }

  // Verify Cloudflare Stream credentials on the deployment where they're set.
  const stream = await checkStream();

  return NextResponse.json(
    {
      status: "ok",
      service: "svideodownload",
      time: new Date().toISOString(),
      cache: {
        backend: cacheBackend, // "redis" (Upstash configured) | "memory" (fallback)
        live, // true only if a write→read round-trip succeeded
        latencyMs,
        ...(error ? { error } : {}),
      },
      stream, // { configured, ok, latencyMs, customerCode, error? }
      downloads: downloadConcurrencyStats(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

import { NextResponse } from "next/server";

import { cacheBackend, cacheGet, cacheSet } from "@/lib/cache";
import { downloadConcurrencyStats } from "@/lib/concurrency";

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
    await cacheSet(probeKey, token, 30);
    const read = await cacheGet<string>(probeKey);
    latencyMs = Math.round(performance.now() - started);
    live = read === token; // round-trip actually persisted + returned our value
  } catch (e) {
    error = e instanceof Error ? e.message : "cache probe failed";
  }

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
      downloads: downloadConcurrencyStats(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

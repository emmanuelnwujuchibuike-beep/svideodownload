import { NextResponse } from "next/server";

import { cacheBackend, cacheGet, cacheSet } from "@/lib/cache";
import { downloadConcurrencyStats } from "@/lib/concurrency";
import { checkStream } from "@/lib/media/stream";
import { hasWebPush } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasWorker, WORKER_SECRET, WORKER_URL } from "@/lib/worker";
import { ytdlpVersion } from "@/server/services/ytdlp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which yt-dlp is doing the work — asked of the machine that actually has one.
 *
 * 🔴 The first version of this just called `ytdlpVersion()` locally, and on the
 * public site that is ALWAYS null: downloads run on the Docker worker, and
 * Vercel has no yt-dlp to ask. So the field shipped, read `null`, and answered
 * nothing — a diagnostic that cannot see the thing it was added to diagnose.
 *
 * On the frontend role it now asks the WORKER's own /api/health and reports what
 * that says, with `role` naming which machine answered so a null is never
 * ambiguous. Short timeout and fully guarded: /api/health is polled by the
 * container's own HEALTHCHECK, and a slow worker must never make the frontend
 * look unhealthy.
 */
async function extractorHealth(): Promise<{ role: string; ytdlp: string | null; error?: string }> {
  if (!hasWorker) return { role: "worker", ytdlp: await ytdlpVersion() };
  try {
    const res = await fetch(`${WORKER_URL}/api/health`, {
      headers: { "x-worker-secret": WORKER_SECRET },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) return { role: "frontend", ytdlp: null, error: `worker health ${res.status}` };
    const body = (await res.json()) as { extractor?: { ytdlp?: string | null } };
    return { role: "frontend", ytdlp: body.extractor?.ytdlp ?? null };
  } catch (e) {
    return { role: "frontend", ytdlp: null, error: e instanceof Error ? e.message : "worker unreachable" };
  }
}

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

  // Push end-to-end state: configured (server VAPID), browser key present,
  // and how many devices have actually subscribed (0 = nobody completed
  // "Turn on push" yet, so no push could ever have been delivered).
  let pushSubscriptions: number | null = null;
  try {
    const { count } = await createAdminClient()
      .from("push_subscriptions")
      .select("id", { head: true, count: "exact" });
    pushSubscriptions = count ?? 0;
  } catch {
    /* leave null if unreadable */
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
      stream, // { configured, ok, latencyMs, customerCode, error? }
      // Web Push: configured = server VAPID keys; publicKeySet = browser key
      // env present; subscriptions = devices that completed "Turn on push".
      push: {
        configured: hasWebPush,
        publicKeySet: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        subscriptions: pushSubscriptions,
      },
      downloads: downloadConcurrencyStats(),
      /*
        🔴 The extractor's own version, because its absence cost a whole
        debugging session (2026-08-11). Every YouTube download was failing at
        every quality, audio included, while metadata answered fine — which from
        outside looks like a hundred different bugs and is nearly always one:
        yt-dlp is installed at IMAGE BUILD time, so an image a few weeks old runs
        a few-week-old yt-dlp, and YouTube's player changes faster than that.

        See `extractorHealth` for why this asks the WORKER rather than the
        machine serving this request.
      */
      extractor: await extractorHealth(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

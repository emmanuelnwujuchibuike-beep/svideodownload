import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { hasWorker, WORKER_SECRET, WORKER_URL } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { ok: boolean; step: string; detail: string };

/**
 * POST /api/admin/sub/blur-clips — "Make the missing blurred clips now", with the reason when it can't (owner,
 * 2026-10-30: locked videos still don't autoplay, and the worker's answers were invisible — the feed's kick is sent
 * after the response and nobody reads it). Checks each link of the chain in order and stops at the first broken one:
 *   1. this server knows the worker (DOWNLOAD_WORKER_URL) and has WORKER_SECRET;
 *   2. the worker answers, with the SAME secret;
 *   3. the worker has storage, the private bucket and ffmpeg (booleans only — never a key or a name);
 *   4. the job is started; its last outcome on the worker is shown.
 * Admins only. Starts nothing that the feed's own kick would not.
 */
export async function POST() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const checks: Check[] = [];
  const done = (status = 200) => NextResponse.json({ checks }, { status, headers: { "cache-control": "no-store" } });

  if (!hasWorker) return checks.push({ ok: false, step: "Worker address", detail: "DOWNLOAD_WORKER_URL is not set on this deployment." }), done();
  checks.push({ ok: true, step: "Worker address", detail: "Set." });
  if (!WORKER_SECRET) return checks.push({ ok: false, step: "Secret on this server", detail: "WORKER_SECRET is not set on this deployment (add it, then redeploy)." }), done();
  checks.push({ ok: true, step: "Secret on this server", detail: "Set." });

  const headers = { "x-worker-secret": WORKER_SECRET, "content-type": "application/json" };
  const ready = await fetch(`${WORKER_URL}/api/internal/sub/blur-clips`, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch((e: unknown) => e);
  if (!(ready instanceof Response)) return checks.push({ ok: false, step: "Worker reachable", detail: `No answer from the worker (${ready instanceof Error ? ready.message.slice(0, 80) : "network error"}).` }), done();
  if (ready.status === 404) return checks.push({ ok: false, step: "Worker up to date", detail: "The worker doesn't have this check yet — it is running an older build. Redeploy it." }), done();
  if (ready.status === 503) return checks.push({ ok: false, step: "Secret on the worker", detail: "WORKER_SECRET is not set on the worker (Railway). Add it with the same value as here, then redeploy." }), done();
  if (ready.status === 403) return checks.push({ ok: false, step: "Secret matches", detail: "The worker's WORKER_SECRET is different from this server's. Make them identical, then redeploy both." }), done();
  if (!ready.ok) return checks.push({ ok: false, step: "Worker reachable", detail: `The worker answered ${ready.status}.` }), done();
  checks.push({ ok: true, step: "Worker reachable, secret matches", detail: "Yes." });

  const r = (await ready.json().catch(() => ({}))) as { storage?: boolean; privateBucket?: boolean; ffmpeg?: boolean; running?: boolean; lastRun?: { at: string; result: Record<string, unknown> } | null };
  checks.push({ ok: !!r.storage, step: "Media storage on the worker", detail: r.storage ? "Set." : "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL must all be set on the worker." });
  checks.push({ ok: !!r.privateBucket, step: "Private bucket on the worker", detail: r.privateBucket ? "Set." : "R2_PRIVATE_BUCKET must be set on the worker (frenzsave-private), different from R2_BUCKET." });
  checks.push({ ok: !!r.ffmpeg, step: "ffmpeg on the worker", detail: r.ffmpeg ? "Installed." : "ffmpeg is missing from the worker image." });
  if (r.lastRun) checks.push({ ok: !r.lastRun.result.skipped, step: "Last run", detail: `${r.lastRun.at}: ${JSON.stringify(r.lastRun.result)}` });
  if (!r.storage || !r.privateBucket || !r.ffmpeg) return done();

  const kick = await fetch(`${WORKER_URL}/api/internal/sub/blur-clips`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  checks.push({ ok: kick?.status === 202, step: "Job started", detail: kick?.status === 202 ? (r.running ? "A run was already going; it carries on." : "Started — clips appear within a few minutes. Check again to see the result.") : `The worker answered ${kick?.status ?? "nothing"}.` });
  return done();
}

import { getPlanLimits, getUserPlan } from "@/lib/monetization/plan";
import type { BillingPlan } from "@/lib/monetization/types";
import { consumeDaily } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { WORKER_SECRET } from "@/lib/worker";

/**
 * Per-plan daily download cap.
 *
 * Keyed by the signed-in user (so their plan's higher cap follows them across
 * devices) or by client IP for anonymous visitors (free tier). Internal
 * worker-proxied calls carry the worker secret and are skipped — the frontend
 * already counted them, so the worker must not double-count.
 */

/** True for internal worker-proxied calls (already metered by the frontend). */
export function isInternalWorkerCall(request: Request): boolean {
  return !!WORKER_SECRET && request.headers.get("x-worker-secret") === WORKER_SECRET;
}

export interface DownloadQuota {
  allowed: boolean;
  used: number;
  limit: number;
  plan: BillingPlan;
}

export async function checkDownloadQuota(
  request: Request,
  clientIp: string,
): Promise<DownloadQuota> {
  // Resolve the caller's identity from the session cookie (null = anonymous).
  // Skip the Supabase round-trip entirely when there's no auth cookie — the
  // common case on this anonymous-heavy endpoint.
  let userId: string | null = null;
  const hasAuthCookie = (request.headers.get("cookie") ?? "").includes("-auth-token");
  if (hasAuthCookie) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      /* treat as anonymous */
    }
  }

  const plan = await getUserPlan(userId);
  const limit = (await getPlanLimits())[plan].dailyDownloads;
  const key = userId ? `dl:u:${userId}` : `dl:ip:${clientIp}`;
  const r = await consumeDaily(key, limit);
  return { allowed: r.allowed, used: r.used, limit: r.limit, plan };
}

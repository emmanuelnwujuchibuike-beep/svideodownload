import { getPlanLimits, getUserPlan } from "@/lib/monetization/plan";
import type { BillingPlan } from "@/lib/monetization/types";
import { alreadyCounted, consumeDaily } from "@/lib/rate-limit";
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
  /**
   * A stable id for the DOWNLOAD (not the request), sent by the client as `t=`.
   *
   * 🔴 Why this exists (owner, 2026-08-09: "all downloads are showing HTTP 429
   * and it affected all platform download"):
   *
   * This function spends a unit of the daily cap on every CALL. Auto-retry
   * shipped the same day and makes up to three calls per download, so a free
   * visitor's 30/day quietly became 10 — and once it ran out, every 429 was
   * itself retried, spending three more units per failure. The counter is keyed
   * by UTC day, so the runaway lasted until midnight.
   *
   * With the id, the first attempt of a download spends the unit and every
   * retry of that SAME download rides on it. The cap now means what it says: a
   * download costs one, however many attempts it takes to deliver.
   *
   * Only a SUCCESSFUL claim is remembered. An attempt that was refused because
   * the cap was already spent marks nothing, so a retry cannot smuggle itself
   * past the limit by reusing a rejected id.
   */
  downloadId?: string | null,
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

  // A retry of a download that already paid for itself passes straight through.
  if (downloadId && (await alreadyCounted(`${key}:${downloadId}`))) {
    return { allowed: true, used: 0, limit, plan };
  }

  const r = await consumeDaily(key, limit, downloadId ? `${key}:${downloadId}` : undefined);
  return { allowed: r.allowed, used: r.used, limit: r.limit, plan };
}

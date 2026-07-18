import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

import type { DownloadContext } from "./types";

/**
 * Server-side recording for the Download Hub. See `docs/DOWNLOAD_HUB_RFC.md` §5.
 *
 * Every write here is best-effort and must never surface an error to the caller —
 * analytics failing is not a reason for a download to fail, or for a "notify me"
 * button to look broken.
 */

/** Stable per-IP identifier. Never store or log the address itself. */
export function hashClient(headers: Headers): string {
  const raw = ((headers.get("x-forwarded-for") ?? "").split(",")[0] || "anon").trim();
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Buckets, not exact values. A precise duration next to a platform and a
 * timestamp starts to identify the specific video — which is the thing this
 * schema is designed not to know.
 */
export function durationBand(seconds: number): "none" | "short" | "medium" | "long" {
  if (!seconds || seconds <= 0) return "none";
  if (seconds <= 90) return "short";
  if (seconds <= 600) return "medium";
  return "long";
}

export function heightBand(height: number): string {
  if (!height || height <= 0) return "unknown";
  if (height <= 480) return "sd";
  if (height <= 720) return "hd";
  if (height <= 1080) return "fhd";
  return "uhd";
}

export async function recordDownloadContext(
  ctx: Pick<DownloadContext, "platformId" | "kind" | "durationSec" | "height" | "plan">,
  userId: string | null,
): Promise<void> {
  try {
    await createAdminClient()
      .from("download_events")
      .insert({
        user_id: userId,
        platform_id: ctx.platformId,
        media_kind: ctx.kind,
        duration_band: durationBand(ctx.durationSec),
        height_band: heightBand(ctx.height),
        plan: ctx.plan,
      });
  } catch {
    /* analytics is never worth an error path */
  }
}

export async function recordImpressions(
  actionIds: string[],
  meta: { platformId: string; kind: string },
  userId: string | null,
): Promise<void> {
  if (actionIds.length === 0) return;
  try {
    await createAdminClient()
      .from("gateway_impressions")
      .insert(
        actionIds.map((action_id) => ({
          user_id: userId,
          action_id,
          outcome: "shown" as const,
          platform_id: meta.platformId,
          media_kind: meta.kind,
        })),
      );
  } catch {
    /* see above */
  }
}

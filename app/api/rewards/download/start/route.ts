import { NextResponse } from "next/server";
import { z } from "zod";

import { RewardError, startRewardSession } from "@/lib/monetization/reward-sessions";
import { clientId, rewardStartLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { ApiError } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const itemSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  formatId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_+\-./]+$/, "Invalid format selector."),
  kind: z.enum(["video", "audio", "image"]),
  title: z.string().trim().max(300).optional(),
});

const schema = z.object({
  type: z.enum(["hd", "batch", "preview"]),
  items: z.array(itemSchema).min(1).max(50),
  /* Which gate opened this. Reporting only — it can never widen what the
     reward grants, since redemption still returns exactly the stored items.
     Optional so a cached older client keeps working. */
  surface: z.enum(["multilink_batch", "batch_download", "hd_download", "video_preview"]).optional(),
});

function fail(code: ApiError["code"], error: string, status: number) {
  return NextResponse.json<ApiError>({ error, code }, { status });
}

/**
 * Start a reward session for an HD or batch download. See
 * lib/monetization/reward-sessions.ts for the full security model.
 */
export async function POST(request: Request) {
  const clientIp = clientId(request.headers);
  const { success } = await rewardStartLimiter.limit(clientIp);
  if (!success) return fail("RATE_LIMITED", "Too many requests. Please wait a moment.", 429);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_REQUEST", "Invalid request body.", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request.", 400);
  }

  // Same "skip the round trip when there's no auth cookie" optimization used
  // throughout (app/api/wallpaper/route.ts, lib/api/download-quota.ts, etc.).
  let userId: string | null = null;
  try {
    if (request.headers.get("cookie")?.includes("-auth-token")) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    }
  } catch {
    /* signed out — the reward flow is still open to anonymous visitors */
  }

  try {
    const session = await startRewardSession({
      type: parsed.data.type,
      items: parsed.data.items,
      userId,
      ip: clientIp,
      surface: parsed.data.surface,
    });
    return NextResponse.json({ rewardSessionId: session.id, expiresAt: session.expiresAt });
  } catch (e) {
    if (e instanceof RewardError) {
      return fail(e.code, e.message, e.code === "FEATURE_DISABLED" ? 403 : 400);
    }
    return fail("INTERNAL", "Couldn't start the reward session.", 500);
  }
}

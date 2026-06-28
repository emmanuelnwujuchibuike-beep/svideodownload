import { NextResponse } from "next/server";

import { corsPreflight, withCors } from "@/lib/api/cors";
import { bearerToken, verifyApiKey } from "@/lib/api/keys";
import { selectAffiliateOffer } from "@/lib/monetization/affiliates";
import { buildRequestContext } from "@/lib/monetization/context";
import { getPlanLimits, getUserPlan } from "@/lib/monetization/plan";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * GET /api/me — identity + entitlements for the browser extension (and any
 * client). Auth via API key (Bearer) or an active session cookie; anonymous
 * callers get the free-tier view. Returns plan, whether to show ads, the daily
 * limits, and (for non-premium) a ready-to-link affiliate offer for the popup.
 */
export async function GET(request: Request) {
  let userId: string | null = null;

  const token = bearerToken(request);
  if (token) {
    const auth = await verifyApiKey(token);
    userId = auth?.userId ?? null;
  }
  if (!userId) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      /* anon */
    }
  }

  const plan = await getUserPlan(userId);
  const limits = (await getPlanLimits())[plan];
  const ctx = buildRequestContext(request, plan);

  let offer = null as null | {
    id: string;
    name: string;
    description: string | null;
    cta: string;
    imageUrl: string | null;
    url: string;
  };
  if (limits.ads) {
    const o = await selectAffiliateOffer(ctx);
    if (o) {
      const base = SITE_URL || new URL(request.url).origin;
      offer = {
        id: o.id,
        name: o.name,
        description: o.description,
        cta: o.cta,
        imageUrl: o.imageUrl,
        url: `${base}/api/go/${o.id}`, // tracked redirect
      };
    }
  }

  return withCors(
    NextResponse.json({
      authenticated: !!userId,
      plan,
      isPremium: plan !== "free",
      showAds: limits.ads,
      limits: {
        dailyDownloads: limits.dailyDownloads,
        batch: limits.batch,
        apiDailyLimit: limits.apiDailyLimit,
      },
      offer,
    }),
  );
}

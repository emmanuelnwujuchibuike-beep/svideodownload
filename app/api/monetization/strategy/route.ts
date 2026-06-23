import { NextResponse } from "next/server";

import { trackEvent } from "@/lib/analytics/events";
import { buildRequestContext } from "@/lib/monetization/context";
import { selectRevenueStrategy } from "@/lib/monetization/decision-engine";
import { getUserPlan } from "@/lib/monetization/plan";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the monetization strategy to render on the download result step for
 * the current visitor (premium → none, else affiliate / ad / upsell). The
 * client renders whatever comes back; all the policy lives server-side.
 */
export async function GET(request: Request) {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* anon */
  }

  const plan = await getUserPlan(userId);
  const dev = new URL(request.url).searchParams.get("dev") === "1";
  const ctx = buildRequestContext(request, plan, dev);
  const strategy = await selectRevenueStrategy(ctx, "download_result_page");

  if (strategy.type === "affiliate") {
    trackEvent("upgrade_prompt_view", {
      userId,
      metadata: { kind: "affiliate", offerId: strategy.offer.id },
    });
  } else if (strategy.type === "premium_prompt") {
    trackEvent("upgrade_prompt_view", { userId, metadata: { kind: "premium" } });
  }

  return NextResponse.json({ strategy });
}

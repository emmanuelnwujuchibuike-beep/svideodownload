import { NextResponse } from "next/server";

import { corsPreflight, withCors } from "@/lib/api/cors";
import { bearerToken, verifyApiKey } from "@/lib/api/keys";
import { selectAffiliateOffer } from "@/lib/monetization/affiliates";
import { getLandingSettings } from "@/lib/landing/settings";
import { buildRequestContext } from "@/lib/monetization/context";
import { getPlanLimits, getUserPlan } from "@/lib/monetization/plan";
import { createAdminClient } from "@/lib/supabase/admin";
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

  /*
    Frenz Coin Part 5: whether the signed-in member's wallet entry points (the /downloads header balance, the profile
    menu card, the chat's Send Frenz Coin) should exist at all. Carried here — a read every member already makes once
    a session — so that while Frenz Coin is off nobody pays a wallet request just to learn it. A display switch only:
    every coin route checks the setting again. The settings read is in memory for 10 s (lib/landing/settings.ts).
  */
  const [plan, frenzCoin] = await Promise.all([getUserPlan(userId), userId ? getLandingSettings().then((s) => s.frenzCoin.enabled, () => false) : Promise.resolve(false)]);
  const limits = (await getPlanLimits())[plan];
  const ctx = buildRequestContext(request, plan);

  // The viewer's profile handle + REAL picture (for "My profile" links and
  // the topbar avatar menu). Null until they set one. `avatar_url` here is
  // the actual Frenz profile picture — a real bug this route's caller
  // (UserMenu) had was reading `user_metadata.avatar_url` (the Supabase
  // AUTH record's own field, only ever set by an OAuth provider like
  // Google) instead of this one, so an account that uploaded a real profile
  // picture through account settings still saw a plain letter avatar in the
  // topbar menu — the two are different columns entirely.
  //
  // `display_name` + `is_verified` come along for the ride (same row, no extra
  // round trip) so the header's profile menu can render the same identity card
  // as the profile page's — name and verified tick included — without a second
  // fetch of its own.
  let handle: string | null = null;
  let avatarUrl: string | null = null;
  let displayName: string | null = null;
  let verified = false;
  if (userId) {
    try {
      const { data } = await createAdminClient()
        .from("profiles")
        .select("handle, avatar_url, display_name, is_verified")
        .eq("id", userId)
        .maybeSingle();
      handle = (data?.handle as string | null) ?? null;
      avatarUrl = (data?.avatar_url as string | null) ?? null;
      displayName = (data?.display_name as string | null) ?? null;
      verified = Boolean(data?.is_verified);
    } catch {
      /* ignore */
    }
  }

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
      handle,
      avatarUrl,
      displayName,
      verified,
      frenzCoin,
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

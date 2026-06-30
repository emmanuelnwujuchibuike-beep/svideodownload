import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { ok } from "@/lib/api/respond";
import { getPlanLimits, getUserPlan } from "@/lib/monetization/plan";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * GET /api/v1/app/me — the signed-in user's identity + entitlements, in the
 * shared envelope. Works for web (cookie) and native/desktop (bearer). Anonymous
 * callers get `{ authenticated: false }` on the free tier rather than a 401, so
 * clients can render a logged-out shell instantly without an extra round trip.
 */
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const plan = await getUserPlan(user?.id ?? null);
  const limits = (await getPlanLimits())[plan];

  let handle: string | null = null;
  let profile: { displayName: string | null; avatarUrl: string | null; isVerified: boolean } | null = null;
  if (user) {
    try {
      const { data } = await createAdminClient()
        .from("profiles")
        .select("handle, display_name, avatar_url, is_verified")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        handle = (data.handle as string | null) ?? null;
        profile = {
          displayName: (data.display_name as string | null) ?? null,
          avatarUrl: (data.avatar_url as string | null) ?? null,
          isVerified: (data.is_verified as boolean) ?? false,
        };
      }
    } catch {
      /* ignore */
    }
  }

  // Personalized → never cache at the shared edge.
  return noStore(
    ok({
      authenticated: !!user,
      userId: user?.id ?? null,
      handle,
      profile,
      plan,
      isPremium: plan !== "free",
      isBusiness: plan === "business",
      showAds: limits.ads,
      limits: {
        dailyDownloads: limits.dailyDownloads,
        batch: limits.batch,
        apiDailyLimit: limits.apiDailyLimit,
      },
    }),
  );
}

import { NextResponse, type NextRequest } from "next/server";

import { trackEvent } from "@/lib/analytics/events";
import { createClient } from "@/lib/supabase/server";

/**
 * /earn/start — the one door from the public /earn page into the EXISTING SUB
 * setup (owner SEO brief 2026-10-11). It keeps /earn itself static: the page
 * never reads a cookie, and this route answers the only question that needs one.
 *
 *   signed out → /login?next=/earn/start?via=login   (the existing sign-in / sign-up;
 *                safeNext there accepts only a same-site path, and this one is fixed)
 *   signed in  → /u/<own handle>?tab=sub              (the SUB tab: Get Paid, 4 steps)
 *   no handle  → /members                             (the creator dashboard links on)
 *
 * Every destination is a path built here, never one taken from the request, so
 * there is nothing to open-redirect. One `earn_funnel` row per tap, past the response.
 * Never indexed: it only ever answers a 303 (plus X-Robots-Tag noindex), and it is
 * not in the sitemap. robots.ts is left alone — its disallow list is pinned by a test.
 */
export const dynamic = "force-dynamic";

const LOGIN = `/login?next=${encodeURIComponent("/earn/start?via=login")}`;

function go(request: NextRequest, path: string) {
  const res = NextResponse.redirect(new URL(path, request.url), 303);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export async function GET(request: NextRequest) {
  const viaLogin = request.nextUrl.searchParams.get("via") === "login";
  let userId: string | null = null;
  let handle: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      userId = user.id;
      const { data } = await supabase.from("profiles").select("handle").eq("id", user.id).maybeSingle();
      handle = (data as { handle?: string | null } | null)?.handle ?? null;
    }
  } catch {
    /* an auth hiccup is "signed out": the sign-in page sorts it out */
  }

  if (!userId) {
    trackEvent("earn_funnel", { metadata: { stage: "cta", signedIn: false } });
    return go(request, LOGIN);
  }
  if (viaLogin) trackEvent("earn_funnel", { userId, metadata: { stage: "returned", signedIn: true } });
  trackEvent("earn_funnel", { userId, metadata: { stage: "setup", signedIn: true } });
  // a handle is [a-z0-9._] in practice; encode it anyway so it can only ever be one path segment
  return go(request, handle ? `/u/${encodeURIComponent(handle)}?tab=sub` : "/members");
}

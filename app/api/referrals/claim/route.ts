import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";
import { claimReferral, REF_COOKIE, REF_PENDING_COOKIE } from "@/lib/referrals/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/referrals/claim — a signed-in member who arrived through a share
 * link: the token in their httpOnly cookie becomes an attribution (once, new
 * accounts only, never self — lib/referrals/server.ts). The member is the
 * session's; the token is the cookie's; the body carries nothing. Both
 * cookies are cleared whatever the answer, so this runs at most once.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const jar = await cookies();
  const token = jar.get(REF_COOKIE)?.value ?? "";
  const res = (body: Record<string, unknown>) => {
    const r = NextResponse.json(body);
    r.cookies.set(REF_COOKIE, "", { maxAge: 0, path: "/" });
    r.cookies.set(REF_PENDING_COOKIE, "", { maxAge: 0, path: "/" });
    return r;
  };
  if (!token) return res({ ok: false, reason: "no_link" });
  const settings = await getLandingSettings();
  const out = await claimReferral(user.id, token, settings.frenzRewards.attribution.windowDays);
  return res({ ok: out.ok, reason: out.reason ?? null });
}

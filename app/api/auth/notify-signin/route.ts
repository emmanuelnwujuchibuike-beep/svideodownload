import { NextResponse } from "next/server";

import { geoFromHeaders, parseUA } from "@/lib/analytics/enrich";
import { notifyAdminsOfSignIn } from "@/lib/analytics/signin-alert";
import { getUserPlan } from "@/lib/monetization/plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/notify-signin — called by the client the moment a sign-in
 * completes. Reads the just-established session, gathers the user's details + geo
 * + device, and alerts every admin by push + email. Deduped by a 1-hour cookie so a
 * re-mount or a repeated call never spams. Always answers ok (best-effort).
 */
export async function POST(request: Request) {
  // Dedup: one alert per sign-in, not per page.
  if (/(?:^|;\s*)frenz_signin_notified=1/.test(request.headers.get("cookie") ?? "")) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });

    const db = createAdminClient();
    const { data: profile } = await db.from("profiles").select("handle, display_name").eq("id", user.id).maybeSingle();
    const plan = await getUserPlan(user.id);
    const geo = geoFromHeaders(request.headers);
    const ua = parseUA(request.headers.get("user-agent"));
    const name = (profile?.display_name as string) || (profile?.handle ? `@${profile.handle as string}` : user.email || "A user");

    await notifyAdminsOfSignIn({
      name,
      handle: (profile?.handle as string | null) ?? null,
      email: user.email ?? null,
      plan,
      country: geo.country,
      city: geo.city,
      device: ua.device,
      browser: ua.browser,
      os: ua.os,
      when: new Date().toUTCString(),
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set("frenz_signin_notified", "1", { maxAge: 60 * 60, path: "/" });
    return res;
  } catch {
    return NextResponse.json({ ok: false });
  }
}

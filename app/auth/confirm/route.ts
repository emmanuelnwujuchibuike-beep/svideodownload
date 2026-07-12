import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { needsMfaStepUp } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Magic-link / email confirmation via `token_hash` + `verifyOtp`. Unlike the
 * PKCE `?code=` callback, this does NOT depend on a verifier cookie, so it works
 * even when the email is opened in a different browser (e.g. an email app's
 * in-app browser) — the most reliable flow for SSR magic links.
 *
 * Point the Supabase "Magic Link" email template at:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/account
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") || "/account";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      if (await needsMfaStepUp(supabase)) {
        return NextResponse.redirect(`${origin}/login/mfa-challenge?next=${encodeURIComponent(next)}`);
      }
      const res = NextResponse.redirect(`${origin}${next}`);
      // Read once by boot-splash.tsx's inline script, then cleared — forces
      // the colored boot logo to show on this one load even if this browser
      // session already booted once (e.g. sign-out then sign back in).
      res.cookies.set("frenz_just_signed_in", "1", { maxAge: 30, path: "/" });
      return res;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirm`);
}

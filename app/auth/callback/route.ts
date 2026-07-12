import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { needsMfaStepUp } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth + magic-link callback. Handles BOTH flows so the link works regardless
 * of how the Supabase email template is configured:
 *   - PKCE:        ?code=...            → exchangeCodeForSession
 *   - token_hash:  ?token_hash=&type=   → verifyOtp (works across devices)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") || "/account";

  // Supabase can redirect here with an explicit error (expired/used link).
  const errDesc = searchParams.get("error_description") || searchParams.get("error");

  if (code || (tokenHash && type)) {
    const supabase = await createClient();
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ type: type!, token_hash: tokenHash! });
    if (!error) {
      // MFA step-up gate (Part 11a): accounts with a verified 2FA factor
      // land on the code challenge instead of `next` until they clear it.
      // Accounts without MFA enrolled are completely unaffected.
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

  const reason = errDesc ? `&reason=${encodeURIComponent(errDesc)}` : "";
  return NextResponse.redirect(`${origin}/login?error=callback${reason}`);
}

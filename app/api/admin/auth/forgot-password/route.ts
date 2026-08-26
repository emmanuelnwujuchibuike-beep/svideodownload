import { NextResponse } from "next/server";

import { checkLoginAllowed, noteLoginFailure } from "@/lib/admin/login-throttle";
import { clientId } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/admin/auth/forgot-password
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hands off to Supabase's own recovery flow. No custom token, no custom table,
 * no custom expiry.
 *
 * ── Why Supabase's flow and not a home-made one ───────────────────────────
 * A reset token is a bearer credential that grants full account takeover. Doing
 * it properly means a cryptographically random token, stored HASHED, expiring,
 * single-use, invalidated on password change, and constant-time compared.
 * Supabase already does all of that and has had it audited; a custom
 * implementation would be a new attack surface built to replace a working one.
 *
 * ── 🔴 THE RESPONSE IS IDENTICAL WHATEVER HAPPENS ─────────────────────────
 * Same JSON, same 200, same timing band, whether the address belongs to an
 * administrator, an ordinary member, or nobody at all. Anything else turns this
 * endpoint into an oracle that answers "is this person an admin here?" — which
 * is the first thing an attacker wants to know and the one thing a password
 * form should never volunteer.
 *
 * That includes NOT checking whether the email is an admin before sending. The
 * check would have to happen before the response, and any branch on it is
 * observable in timing. Supabase's own recovery mail is harmless to a
 * non-admin: it lets a member reset the password of an account that cannot
 * reach /admin anyway, which is the same thing the member-facing reset already
 * does.
 */
export async function POST(request: Request) {
  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim() : "";
  } catch {
    /* fall through to the generic answer */
  }

  const generic = NextResponse.json({
    ok: true,
    message: "If an account exists for this email, a password reset link has been sent.",
  });

  if (!email || !email.includes("@")) return generic;

  /*
    Rate limited on the same ledger as the login form. Password-reset endpoints
    are a favourite for mail-bombing a known address and for enumerating
    accounts by timing; both are attempts against this origin and both are
    counted here.
  */
  const ip = clientId(request.headers);
  const gate = await checkLoginAllowed(email, ip);
  if (!gate.allowed) {
    // Still the generic body — a 429 here would confirm the address is one the
    // system takes seriously. The attacker learns only that they are rate
    // limited, which they already know.
    return generic;
  }

  try {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      /*
        Where the emailed link lands. It MUST be an absolute URL on this origin
        and it MUST be listed in Supabase's Redirect Allow List — an unlisted
        URL is silently replaced by the project's Site URL, which would drop the
        operator on the member home page holding a recovery token and no form to
        use it with. See the deployment notes in the summary.
      */
      redirectTo: `${SITE_URL}/admin/reset-password`,
    });
  } catch {
    /*
      Swallowed on purpose. A mail-provider outage must not change the response,
      because a different response is the enumeration leak this whole route is
      shaped to avoid.
    */
  }

  // Counted as an attempt against this identifier so the endpoint cannot be
  // used as an unlimited mail cannon.
  await noteLoginFailure(email, ip);

  return generic;
}

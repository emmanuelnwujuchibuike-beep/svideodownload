import { NextResponse } from "next/server";

import { validateAdminPassword } from "@/lib/admin/password-policy";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/admin/auth/reset-password
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Completes a recovery. Called by `/admin/reset-password` once Supabase has
 * exchanged the emailed link for a RECOVERY session.
 *
 * ── What authorises this call ─────────────────────────────────────────────
 * The recovery session itself, and nothing else. The client sends only the new
 * password; there is no user id, no email and no token in the body, because
 * every one of those would be a value the caller could change. `getUser()`
 * below resolves the account from the verified session cookie, so this route
 * can only ever change the password of whoever actually opened the emailed
 * link.
 *
 * ── 🔴 SINGLE USE, AND SESSIONS REVOKED ───────────────────────────────────
 * Supabase invalidates a recovery token when it is exchanged, so the link
 * cannot be replayed. What Supabase does NOT do is end the other sessions, so
 * this route does it: after a successful change every other refresh token is
 * revoked. Without that, an attacker who had already stolen a session keeps it
 * indefinitely, and the password change the victim just performed to evict them
 * would have achieved nothing.
 */
export async function POST(request: Request) {
  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Enter a new password." }, { status: 400 });
  }

  // Policy is enforced HERE, server-side. The identical check runs in the form
  // for instant feedback, but that copy is a convenience — this is the one that
  // decides, because the form can be bypassed.
  const verdict = validateAdminPassword(password);
  if (!verdict.ok) {
    // `verdict.reason` never contains the password — see password-policy.ts.
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one." },
      { status: 401 },
    );
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    /*
      🔴 Supabase's message is NOT forwarded. It can name the account, and for a
      same-password rejection it confirms the previous password to anyone
      holding the link. A generic sentence plus the policy text the form already
      showed is everything a legitimate user needs.
    */
    return NextResponse.json(
      { error: "Could not update the password. Request a fresh reset link and try again." },
      { status: 400 },
    );
  }

  /*
    Evict every OTHER session. `scope: "others"` deliberately keeps the session
    that just performed the change, so the operator is not bounced back to the
    login form the instant they succeed — they continue to the dashboard, and
    every other device is signed out.
  */
  try {
    await supabase.auth.signOut({ scope: "others" });
  } catch {
    /* the password is already changed; a failed revoke is not worth an error */
  }

  return NextResponse.json({ ok: true });
}

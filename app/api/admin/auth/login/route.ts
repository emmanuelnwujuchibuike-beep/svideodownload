import { NextResponse } from "next/server";

import { isAdmin } from "@/lib/admin";
import {
  checkLoginAllowed,
  clearLoginFailures,
  noteLoginFailure,
} from "@/lib/admin/login-throttle";
import { clientId } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/admin/auth/login
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 WHY THE SIGN-IN IS SERVER-SIDE AT ALL ──────────────────────────────
 *
 * Everywhere else in this app the browser calls `supabase.auth
 * .signInWithPassword()` directly, and that is fine for members. It is not fine
 * for the admin login, because a browser-side call goes straight from the
 * visitor to Supabase — this origin never sees the attempt, so it cannot count
 * it, delay it, or lock it out. Any throttle written around a client-side call
 * is decoration an attacker skips by calling Supabase themselves.
 *
 * Routing it through here makes the attempt something the server observes and
 * therefore something the server can refuse. `@supabase/ssr`'s server client
 * writes the same session cookies the browser client would have, so the rest of
 * the app — middleware, RSC, the browser client — sees an ordinary session and
 * nothing else changes.
 *
 * ── What this route deliberately does NOT do ──────────────────────────────
 *
 *  • It never says whether the email exists, whether the password was wrong, or
 *    whether the account simply is not an administrator. All three return the
 *    same sentence. Distinguishing them is a free account-enumeration oracle.
 *  • It never logs the password, the email, or the Supabase error text. The
 *    error object from a failed sign-in can contain the submitted address, and
 *    this project's error tracking would then carry it.
 *  • It sets no cookie of its own. There is no "admin session" separate from the
 *    Supabase session — a second, home-made session is a second thing to get
 *    wrong.
 */

/** The ONLY message a failed attempt ever produces. */
const GENERIC_FAILURE = "Incorrect email or password.";

export async function POST(request: Request) {
  let email = "";
  let password = "";

  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    email = typeof body.email === "string" ? body.email.trim() : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 400 });
  }

  const ip = clientId(request.headers);

  /*
    The throttle is consulted BEFORE Supabase is contacted. Checking afterwards
    would still let every attempt reach the auth server, which is the resource
    being protected.
  */
  const gate = await checkLoginAllowed(email, ip);
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: "Too many attempts. Try again shortly.",
        retryAfterSeconds: gate.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } },
    );
  }

  // The escalating pre-answer delay. Applied before the attempt so it costs the
  // attacker wall-clock time whether or not the guess was right.
  if (gate.delayMs > 0) {
    await new Promise((r) => setTimeout(r, gate.delayMs));
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    await noteLoginFailure(email, ip);
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
  }

  /*
    🔴 AUTHENTICATED IS NOT AUTHORIZED.

    The credentials were correct — this is a real Frenzsave member. Whether they
    may enter /admin is a separate question, asked here against the database.

    A non-admin who signs in through this form is SIGNED OUT again immediately.
    Leaving them signed in would be a working member session minted by the admin
    login form, and their next request would land them in the app as themselves
    — confusing at best, and it would also let this endpoint be used as an
    ordinary login that happens to bypass the member flow's own protections.
  */
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (!isAdmin(profile?.role, data.user.email)) {
    await supabase.auth.signOut();
    // Counted as a failure: repeated correct-password attempts from a non-admin
    // account against the ADMIN form are exactly the probing this exists to slow.
    await noteLoginFailure(email, ip);
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
  }

  await clearLoginFailures(email, ip);

  /*
    MFA: if this administrator has a verified TOTP factor, the session is at
    aal1 and must be stepped up before it is worth anything. The client is told
    where to go; the ENFORCEMENT is not here — `requireAdminPage` and the
    middleware both re-check on the next request, so a client that ignores this
    field simply gets bounced.
  */
  let mfaRequired = false;
  try {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    mfaRequired = !!aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel;
  } catch {
    /* MFA unavailable — treat as not enrolled rather than blocking the login */
  }

  return NextResponse.json({ ok: true, mfaRequired });
}

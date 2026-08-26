import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin/require-admin";
import { markReauthenticated } from "@/lib/admin/reauth";
import { checkLoginAllowed, noteLoginFailure } from "@/lib/admin/login-throttle";
import { clientId } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/admin/auth/reauth — prove it is still you
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sensitive operations (payment settings, deleting users, changing admins,
 * balances) require the password again, recently, even though the session is
 * perfectly valid.
 *
 * This is the answer to the one real hole a long-lived session leaves: an
 * unlocked laptop. The session is legitimately valid for weeks — that is the
 * requirement — so the control cannot be a session timeout. It is a fresh proof
 * of knowledge at the moment of the dangerous action.
 *
 * ── 🔴 THE PASSWORD IS VERIFIED, NEVER STORED ─────────────────────────────
 * It is sent once, checked against Supabase, and goes out of scope. Nothing
 * writes it anywhere, and the marker it produces (see lib/admin/reauth.ts) is a
 * signed, short-lived, HttpOnly cookie containing a timestamp and the user id —
 * no credential material at all.
 *
 * ── Why `signInWithPassword` and not a dedicated "verify" call ────────────
 * Supabase has no password-verification endpoint that leaves the session alone.
 * Signing in again with the SAME credentials re-issues the same account's
 * session, which is a no-op from the app's point of view: same user, same
 * cookies, freshly rotated. What it proves is that the person at the keyboard
 * knows the password.
 */
export async function POST(request: Request) {
  // Only an already-authenticated administrator may even attempt this. Without
  // this line the endpoint would be an unauthenticated password oracle.
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 });
  }

  if (!password) {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 });
  }

  const email = gate.user.email;
  if (!email) {
    return NextResponse.json({ error: "Could not verify." }, { status: 400 });
  }

  // Throttled on the same ledger as the login form: this endpoint takes a
  // password, so it is a guessing target like any other.
  const ip = clientId(request.headers);
  const allowed = await checkLoginAllowed(email, ip);
  if (!allowed.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(allowed.retryAfterSeconds) } },
    );
  }
  if (allowed.delayMs > 0) await new Promise((r) => setTimeout(r, allowed.delayMs));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    await noteLoginFailure(email, ip);
    // Generic, and identical to the login form's wording.
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  await markReauthenticated(gate.user.id);

  return NextResponse.json({ ok: true });
}

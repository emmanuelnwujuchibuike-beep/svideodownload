import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign out — hardened so it can NEVER 500, and always logs the user out on THIS
 * device (owner, 2026-07-21: "i cant sign out", HTTP 500 on /auth/signout).
 *
 * The previous body was `await supabase.auth.signOut()` with the DEFAULT
 * `scope: "global"`, which makes a network round-trip to Supabase's /logout
 * endpoint to revoke every session — and let ANY throw from it bubble up as an
 * unhandled 500: a corrupted/oversized auth cookie the token parser chokes on, an
 * unreachable or slow auth server, a rejected refresh token. The cruel part is
 * that the one action that would FIX a broken session — signing out — was the
 * thing that failed, so the user was stuck.
 *
 * Sign-out is an intent that must always succeed locally: it means "forget me on
 * this device." So:
 *   1. `scope: "local"` — clears the session with no dependency on the auth
 *      server being reachable (that round-trip is what could hang or throw);
 *      "sign out everywhere" is a separate, explicit action (active-sessions).
 *   2. wrapped in try/catch so nothing it does can 500 the route;
 *   3. belt-and-braces — expire every `sb-*` auth cookie directly on the
 *      response, so even a token so broken that step 1 threw before it could
 *      remove them still lands the browser signed out.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Never let a bad session block sign-out — the cookie clear below is the
    // real guarantee.
  }

  // 303 so the browser issues a GET to the home page after the POST.
  const res = NextResponse.redirect(new URL("/", request.url), { status: 303 });

  // Expire every Supabase auth cookie straight on the response. Name + path must
  // match how they were written (SUPABASE_COOKIE_OPTIONS uses path "/"); this
  // also covers the chunked `sb-<ref>-auth-token.0/.1/…` variants a large
  // session is split into.
  try {
    const cookieStore = await cookies();
    for (const c of cookieStore.getAll()) {
      if (c.name.startsWith("sb-")) {
        res.cookies.set(c.name, "", { path: "/", maxAge: 0 });
      }
    }
  } catch {
    /* cookie store unavailable — the local signOut above already cleared them */
  }

  return res;
}

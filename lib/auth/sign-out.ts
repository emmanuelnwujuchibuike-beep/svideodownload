"use client";

import { createClient } from "@/lib/supabase/client";

import { clearIdentity } from "./identity-cache";

/**
 * Robust, client-first sign-out.
 *
 * The server form POST alone left this device (owner, 2026-07-22, admin account
 * on a laptop) still showing the avatar + plan-gated UI after "sign out": the
 * browser Supabase client's `sb-*-auth-token` cookie and the painted-identity
 * cache both survived the navigation, so the next render of the landing header
 * still read a live session and `/api/me` still answered "premium". The header
 * deliberately keeps painting the last-known avatar while `user` is null (to
 * avoid a login flash on a transient blip), so a session that isn't actually
 * cleared reads as "never signed out".
 *
 * This clears everything the CLIENT decides "signed in" from, with no dependency
 * on a server round-trip succeeding (sign-out must never hang on one — see
 * app/auth/signout/route.ts):
 *
 *   1. drop the identity cache so the header can't repaint the last face;
 *   2. `signOut({ scope: "local" })` on the browser client — deletes the auth
 *      cookies this client wrote (document.cookie) + any persisted session and
 *      fires SIGNED_OUT, without waiting on Supabase's /logout endpoint;
 *   3. belt-and-braces: expire the cookies server-side too, so the SSR view and
 *      `/api/me` agree — fire-and-forget, we don't follow its redirect;
 *   4. hard navigation home, which resets every in-memory module cache
 *      (useUser's `cachedUser`, useEntitlements' `cache`) so nothing signed-in
 *      survives into the next render.
 */
export async function signOutClient(): Promise<void> {
  clearIdentity();

  // Clear the "just signed in" splash cookie so the hard navigation to `/` below
  // can never make BootSplash force its F loader on sign-out (owner, 2026-08-02:
  // "the F loader also shows on sign out, which i don't want"). It's normally a
  // one-shot session cookie the boot script clears, but a sign-out must never
  // depend on that having happened.
  try {
    document.cookie = "frenz_just_signed_in=; Max-Age=0; path=/";
  } catch {
    /* cookies blocked — nothing to clear */
  }

  try {
    await createClient().auth.signOut({ scope: "local" });
  } catch {
    /* the cookie clear + hard nav below still sign this browser out */
  }

  try {
    await fetch("/auth/signout", { method: "POST", redirect: "manual" });
  } catch {
    /* offline — the local sign-out above already cleared this device */
  }

  window.location.assign("/");
}

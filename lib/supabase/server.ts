import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";

/**
 * Server-side Supabase client bound to the request cookies. Use in Server
 * Components, Route Handlers and Server Actions. RLS is enforced via the
 * authenticated user's JWT.
 *
 * `cache()`-wrapped (2026-07-16, real bug): `/messages` has both a
 * `layout.tsx` and a `page.tsx` that each independently used to call this and
 * then `getUserBounded()` for the same request. Two separate client
 * instances read the SAME (possibly expired) refresh token cookie and each
 * attempted their own refresh — Supabase rotates refresh tokens (single-use),
 * so whichever call went first succeeded in-memory (unpersisted — a Server
 * Component structurally can't write cookies) while the second got a real
 * `AuthApiError: Invalid Refresh Token: Refresh Token Not Found`. Middleware
 * normally would refresh once up front, but deliberately skips that for RSC/
 * soft navigations to non-guarded routes (see middleware.ts's `isRscNav`
 * bypass) — exactly the path both a plain in-app reopen of Messages and
 * `EdgeSwipeBack`'s `router.back()` (the iOS swipe-back gesture) take. Since
 * nothing could ever persist the winning refresh, this repeated identically
 * on every subsequent request — a genuine "stuck" loop, not a timeout.
 * `cache()` memoizes this per request, so every caller in the same render
 * (layout + page) shares ONE client/session instead of racing two.
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware
            // refreshes the session cookie on navigation.
          }
        },
      },
    },
  );
});

/**
 * `auth.getUser()` with a hard time-box, for SERVER PAGES on the render
 * critical path. The un-time-boxed call sits between the request and the
 * page's loading.tsx skeleton resolving — a stalled socket to Supabase's
 * auth endpoint held pages on their skeleton indefinitely (the "stuck at
 * loading" symptom; full trace in docs/STARTUP_AUDIT.md).
 *
 * The three outcomes are deliberately DISTINCT so a slow network never
 * masquerades as "signed out": `user` (proceed), `signed-out` (redirect to
 * login), `timeout` (render the page's Retry state — do NOT redirect).
 *
 * `cache()`-wrapped: `/messages` renders both a layout (its desktop pane) and a
 * page, each of which calls this for the SAME request. `getUser()` is a network
 * round-trip to the auth server EVERY call — it re-validates the JWT rather
 * than trusting the in-memory session — so sharing one client (above) deduped
 * the client but NOT the traffic. Memoizing here collapses those two
 * round-trips into one, on the critical path of every /messages load.
 *
 * CLASSIFICATION (2026-07-16, the real "/messages keeps re-logging me in"
 * bug): `getUser()` does NOT throw auth failures — auth-js catches them and
 * RETURNS `{ data: { user: null }, error }`, only ever throwing for non-auth
 * exceptions (see `_getUser`'s catch in @supabase/auth-js's GoTrueClient). The
 * previous version only looked at `data.user` and never read `error`, so a
 * transient `AuthRetryableFetchError` — a flaky mobile network, a resuming
 * device, an upstream blip — arrived as `user: null` and was indistinguishable
 * from a genuine sign-out. /messages then redirected to /login, whose own
 * `getUser()` (a moment later, network recovered) found a perfectly valid
 * session and redirected straight back. That round trip through the login page
 * IS the owner's "it loads like I'm re-logging in again" — the app really was
 * navigating to /login and back. Reading `error` is what separates "the auth
 * server says this session is dead" (sign out, correct) from "we couldn't reach
 * the auth server" (retry, never sign out).
 */
export const getUserBounded = cache(async function getUserBounded(
  supabase: Awaited<ReturnType<typeof createClient>>,
  timeoutMs = 6000,
): Promise<{ kind: "user"; user: User } | { kind: "signed-out" } | { kind: "timeout" }> {
  try {
    const { data, error } = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("auth timeout")), timeoutMs)),
    ]);
    if (data.user) return { kind: "user", user: data.user };
    // Couldn't REACH the auth server (fetch failed / 5xx / aborted). The
    // session may be perfectly valid — bouncing to /login here is what caused
    // the login round-trip described above. Render Retry instead; unlike the
    // dead-session case this is genuinely winnable, since the next attempt runs
    // once the network is back.
    if (error && isAuthRetryableFetchError(error)) return { kind: "timeout" };
    // Any other returned error is the auth server AUTHORITATIVELY rejecting the
    // session (e.g. `AuthApiError: Invalid Refresh Token`, `AuthSessionMissing`)
    // — genuinely signed out. Kept as a redirect on purpose: treating it as
    // "timeout" was itself a real bug, rendering an unwinnable Retry against a
    // session that can never come back.
    return { kind: "signed-out" };
  } catch (error) {
    // Our own race-timer fired: slow, not dead.
    if (error instanceof Error && error.message === "auth timeout") return { kind: "timeout" };
    // A THROWN error is by definition not an auth error (auth-js returns those
    // — see above), so it's an infrastructure/runtime failure. Retry, don't
    // sign out: this path can't be the dead-session case that required a
    // redirect, so there's no unwinnable-Retry risk in staying conservative.
    return { kind: "timeout" };
  }
});

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
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
 */
export async function getUserBounded(
  supabase: Awaited<ReturnType<typeof createClient>>,
  timeoutMs = 6000,
): Promise<{ kind: "user"; user: User } | { kind: "signed-out" } | { kind: "timeout" }> {
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("auth timeout")), timeoutMs)),
    ]);
    return result.data.user ? { kind: "user", user: result.data.user } : { kind: "signed-out" };
  } catch (error) {
    // Only OUR OWN race-timer rejection means "genuinely slow, try again" —
    // any other thrown error is Supabase's own `getUser()` failing outright
    // (2026-07-16, real bug: a real `AuthApiError: Invalid Refresh Token`,
    // caused by two independent server clients racing to refresh the same
    // single-use token — see createClient()'s comment above). Lumping that
    // in with "timeout" rendered an unwinnable "Retry" state: the underlying
    // session is actually dead, so every retry hit the identical error
    // forever ("stuck in reload" on /messages). Treating it as signed-out
    // instead sends the user to a real, working /login.
    if (error instanceof Error && error.message === "auth timeout") {
      return { kind: "timeout" };
    }
    return { kind: "signed-out" };
  }
}

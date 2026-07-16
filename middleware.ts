import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isAdmin } from "@/lib/admin";
import { CORS_HEADERS } from "@/lib/api/cors";
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import { sessionIsComfortablyFresh } from "@/lib/supabase/session-cookie";

/**
 * Refreshes the Supabase auth session on each request (so access tokens stay
 * fresh and server components see the right user) and guards protected routes.
 * If Supabase env vars are absent (e.g. the worker), it is a no-op pass-through.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Public API + extension endpoints: enable CORS and skip session work.
  if (path.startsWith("/api/v1") || path === "/api/me") {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  }

  // Prefetch requests only warm the route's loading boundary — they don't render
  // user content or navigate, so skip the Supabase auth round-trip. This makes
  // link prefetching (which drives instant navigation) return faster, while real
  // navigations still run the full session refresh + route guards below.
  if (
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch"
  ) {
    return NextResponse.next({ request });
  }

  const needsGuard = path.startsWith("/account") || path.startsWith("/admin");

  // No Supabase auth cookie → the visitor is definitely signed out. Skip the
  // getUser() network round-trip entirely (the biggest latency on a cold entry).
  // Protected routes still bounce to /login; everything public passes straight
  // through with no auth work — this is what makes first loads fast.
  const cookies = request.cookies.getAll();
  const hasAuthCookie = cookies.some((c) => c.name.includes("-auth-token"));
  if (!hasAuthCookie) {
    if (needsGuard) {
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set("next", path);
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next({ request });
  }

  // Fast path: the access token is still comfortably valid, so there is nothing
  // to refresh and no page downstream will try to (the freshness margin is set
  // above auth-js's own — see sessionIsComfortablyFresh). Skip the round-trip.
  //
  // This REPLACES a blanket "skip auth for any RSC navigation" bypass, which was
  // a real bug (owner, recurring: "the message page keeps reloading like it's
  // re-logging me in, and the back-swipe sits on the F loader"). That bypass
  // made middleware skip the session refresh on exactly the paths a soft nav and
  // EdgeSwipeBack's `router.back()` take — so when the access token HAD expired
  // (returning to the PWA after an hour away, the common case for a back-swipe),
  // the refresh fell to the Server Component, which cannot persist the rotated
  // single-use token. The rotation was burned on every such request, the cookie
  // kept replaying the dead token, and `getUser()` then failed for real —
  // surfacing as a bounce through /login, indistinguishable from being logged
  // out. Keying on the token's ACTUAL expiry instead of the request type is both
  // safer (a stale token now always refreshes HERE, where cookies can be
  // written) and faster (a fresh token now skips the round-trip on full document
  // loads too, which always paid for it before).
  //
  // Guarded routes are deliberately excluded: their decision is an authorization
  // one, so they always verify against the auth server rather than trusting an
  // unauthenticated cookie hint.
  if (!needsGuard && sessionIsComfortablyFresh(cookies)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    // Middleware is the ONLY writer that can persist a rotated refresh token
    // (see lib/supabase/session-cookie.ts), so it is the single most important
    // place these flags are correct — it's what re-writes the cookie on every
    // refresh. Must match the server + browser clients exactly.
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
      ) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Time-boxed (5s): this await sits on the critical path of EVERY document
  // load that carries an auth cookie — nothing paints until it settles. A
  // stalled socket to Supabase's auth endpoint (flaky mobile network, waking
  // laptop, upstream outage) used to hold the whole tab on a blank/loader
  // state indefinitely — the "app stuck at loading" symptom (see
  // docs/STARTUP_AUDIT.md). On timeout the request passes through
  // un-refreshed: every page still runs its own auth guard, and the next
  // successful request refreshes the session cookie.
  const AUTH_TIMEOUT_MS = 5000;
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("auth timeout")), AUTH_TIMEOUT_MS)),
    ]);
    user = result.data.user;
  } catch {
    // Fail CLOSED for /admin (its pages re-check admin server-side too, but
    // the middleware gate shouldn't silently disappear on a slow network);
    // everything else passes through and self-guards.
    if (path.startsWith("/admin")) return NextResponse.redirect(new URL("/", request.url));
    return response;
  }

  const { pathname } = request.nextUrl;
  const isProtected =
    pathname.startsWith("/account") || pathname.startsWith("/admin");

  if (!user && isProtected) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Admins only for /admin.
  if (user && pathname.startsWith("/admin")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!isAdmin(profile?.role, user.email)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|twitter-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isAdmin } from "@/lib/admin";
import { CORS_HEADERS } from "@/lib/api/cors";

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

  // Soft client navigations (React Server Component fetches, `RSC: 1`) to
  // non-protected pages: skip the blocking getUser() round-trip so the switch is
  // instant. Safe because (a) full document loads + every /api call still refresh
  // the session cookie, and (b) protected pages (/account, /admin) fall through to
  // the full guard below. This is the main lever for snappy in-app navigation.
  const isRscNav = request.headers.get("rsc") === "1";
  const needsGuard = path.startsWith("/account") || path.startsWith("/admin");
  if (isRscNav && !needsGuard) {
    return NextResponse.next({ request });
  }

  // No Supabase auth cookie → the visitor is definitely signed out. Skip the
  // getUser() network round-trip entirely (the biggest latency on a cold entry).
  // Protected routes still bounce to /login; everything public passes straight
  // through with no auth work — this is what makes first loads fast.
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.includes("-auth-token"));
  if (!hasAuthCookie) {
    if (needsGuard) {
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set("next", path);
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

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

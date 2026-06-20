import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware.
 *
 * Currently a lightweight pass-through. Supabase session refresh and the
 * `/admin` route guard will be added here in Phase 2 alongside auth — they are
 * intentionally NOT imported yet so the Edge bundle stays free of Node-only
 * APIs (avoids the `process.version` Edge-runtime warning during build).
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

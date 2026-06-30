import { NextResponse } from "next/server";

/**
 * Permissive CORS for the public API + first-party app clients (web, iOS,
 * Android, desktop) + the browser extension. All four clients share one backend,
 * so every REST verb is allowed and the Supabase bearer token is an accepted
 * header alongside the developer `X-Api-Key`.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Api-Key, X-Client",
  "Access-Control-Expose-Headers": "X-Request-Id",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

import { readCookieJar } from "@/lib/dom/cookie";

/**
 * Whether a Supabase auth cookie is present — a synchronous, request-free
 * "could anyone be signed in here?".
 *
 * The cookie is deliberately readable from JS (lib/supabase/cookie-options.ts —
 * the browser Supabase client needs it). This only ever lets a caller SKIP a
 * request when the cookie is ABSENT; any cookie at all falls through to the
 * authoritative server, so a stale or malformed cookie cannot hide a real
 * session. Moved out of features/auth/use-entitlements.ts (2026-10-05) so the
 * inbox and the nav warm-up use the SAME test rather than a second regex.
 *
 * On the server it answers `true`: callers re-check in an effect.
 */
export function hasAuthCookie(): boolean {
  if (typeof document === "undefined") return true;
  // Guarded read: a sandboxed embed throws on `document.cookie`, and "no
  // cookies" must read as signed-out, not as a crash (lib/dom/cookie.ts).
  return /(^|;\s*)sb-[^=]*-auth-token/.test(readCookieJar());
}

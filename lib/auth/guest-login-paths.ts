/**
 * Member-only pages that send a signed-out visitor to /login from INSIDE a
 * full server render — `if (!user) redirect("/login…")` at the top of the
 * page. Middleware now answers those guests with an edge 307 instead, before
 * any render (2026-10-05).
 *
 * Measured on a production build: a guest opening /downloads paid a complete
 * server render of the page and THEN a script-driven navigation to /login —
 * two renders, the first thrown away. A guest's idle prefetch of /home or
 * /friends was a full private render answering 200 with a redirect inside.
 *
 * 🔴 ONLY the no-cookie branch uses this. Adding these to middleware's
 * `needsGuard` instead would force a Supabase `getUser()` on every MEMBER
 * request to them — a new cost for members to save one for guests.
 *
 * `/account`, `/ai/*` (not `/ai` itself — lib/auth/ai-public-paths.ts), `/studio`,
 * `/admin` are already guarded by `needsGuard`.
 * `lib/auth/guest-login-paths.test.ts` keeps this list and the pages in step,
 * in both directions.
 */
export const GUEST_LOGIN_PREFIXES = [
  "/create",
  "/downloads",
  "/friends",
  "/home",
  "/notifications",
  "/saved",
  "/welcome",
] as const;

export function guestMustLogin(path: string): boolean {
  return GUEST_LOGIN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

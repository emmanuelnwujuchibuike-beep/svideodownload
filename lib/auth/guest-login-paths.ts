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
  "/exclusive", // Frenz Exclusive Part 3: the Exclusive feed (posts from creators you subscribe to)
  "/friends",
  "/home",
  "/members", // Feature 19 Part 13: the creator dashboard and your memberships
  "/memories", // Feature 19 Part 14: Shared Memories and Life Journey
  "/network", // Feature 19 Part 12: the professional dashboard, discovery and opportunities
  "/notifications",
  "/rewards",
  "/saved",
  "/welcome",
] as const;

/** Pages under a listed prefix that a guest may OPEN (owner, 2026-10-16: /friends shows, locked behind sign-in). */
export const GUEST_OPEN_EXACT = new Set(["/friends"]);

export function guestMustLogin(path: string): boolean {
  if (GUEST_OPEN_EXACT.has(path)) return false;
  return GUEST_LOGIN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * App-only routes — signed-in surfaces that a signed-out visitor never receives (owner, 2026-10-29, AdSense review).
 *
 * The middleware answers a guest's request for any of these with an edge redirect to `/login?next=…` BEFORE any
 * render, so the server never builds a feed, post, reel, profile or sound for a guest. A client-side "Loading…"
 * check is not enough: the HTML a crawler or a reviewer reads must not carry the content at all.
 *
 * This list wins over `GUEST_OPEN_EXACT` (lib/auth/guest-login-paths.ts): `/exclusive` used to open for guests,
 * locked behind sign-in, and no longer does. `/friends` opens for guests again (2026-10-30 — see below).
 *
 * Profiles: `/chris` is REWRITTEN to `/u/chris` before the guard runs (lib/social/profile-url.ts), so `/u` covers
 * every top-level profile URL too. Every route here also carries `robots: { index: false, follow: false }`, and
 * robots.ts disallows the same list (`APP_ONLY_PREFIXES` is the one source for both).
 *
 * The one exception (code review, 2026-10-30): a LINK-PREVIEW fetcher (WhatsApp, X, iMessage… —
 * lib/seo/link-preview-bots.ts) is answered with a share card — title, description, picture, never the page — so a
 * shared profile, sound or reel link draws its own preview instead of the login page's. Search and ad crawlers are
 * never on that list.
 *
 * Exact segment match: `/sound` matches `/sound` and `/sound/…`, never `/sounds` (listed separately) or `/soundtrack`.
 */
/*
  🔴 NOT HERE, ON PURPOSE (owner, 2026-10-30: "bring back the bottom NAV and the ad button … don't send my users away"):
  the guest bottom nav's own tabs — /friends, /history, /messages (Chats), /profile — and the header's Ad button
  (/advertise/campaigns) open for a guest again exactly as before 2026-10-29: Friends shows its locked page, History
  the visitor's own downloads, Chats an empty inbox with a sign-in prompt, Profile the guest page. Gating them sent
  every guest who tapped the nav straight to /login. Everything else on this list stays gated.
*/
export const APP_ONLY_PREFIXES = [
  "/account",
  "/exclusive",
  "/explore",
  "/feed", // the guest copy of the /home feed — not on the owner's list, gated because it renders the feed to guests
  "/home",
  "/notifications",
  "/quests",
  "/reels",
  "/saved",
  "/search",
  "/sound",
  "/sounds",
  "/u",
] as const;

export function isAppOnlyPath(path: string): boolean {
  return APP_ONLY_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

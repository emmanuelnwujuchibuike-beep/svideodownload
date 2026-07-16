import type { CookieOptions } from "@supabase/ssr";

/**
 * Hardened cookie flags for the Supabase session, applied to EVERY client that
 * can write it (server, middleware, browser). @supabase/ssr's own
 * `DEFAULT_COOKIE_OPTIONS` is `{ path, sameSite: "lax", httpOnly: false,
 * maxAge: 400d }` — note there is **no `secure` flag at all**, so by default the
 * session cookie is legal to send over plain HTTP.
 *
 * In practice this app's HSTS header (`max-age=63072000; includeSubDomains;
 * preload`) already forces HTTPS, so the exposure is narrow — but HSTS is a
 * *browser-remembered* promise: it does nothing on the very first visit from a
 * browser that has never seen the header and isn't on the preload list. `Secure`
 * is enforced by the cookie itself, unconditionally, with no trust-on-first-use
 * window. Defence in depth: they cover different moments, so both.
 *
 * ── On `httpOnly` (deliberately NOT set — read this before "fixing" it) ──
 * Setting `httpOnly: true` here WILL break the app, not harden it. Supabase's
 * browser client (`createBrowserClient`, used by 24 files — realtime messaging,
 * presence, the notification bell, history sync, the download player) reads this
 * cookie from `document.cookie` to know who the viewer is. Made httpOnly, the
 * browser client sees no session and every one of those silently behaves as
 * signed-out.
 *
 * Getting a genuinely httpOnly session — the bank/betting-app pattern — is not a
 * flag flip; it's a BFF refactor: every client-side Supabase call proxies through
 * a route handler, and realtime needs a server-minted short-lived token. That's a
 * real project, tracked separately. Until then the honest control against session
 * theft is a CSP that actually blocks injected script (see next.config.ts) —
 * XSS is the only thing that makes a JS-readable cookie worse than an httpOnly
 * one, so that is where the defence belongs.
 */
export const SUPABASE_COOKIE_OPTIONS: CookieOptions = {
  path: "/",
  // `lax` (not `strict`): the OAuth/magic-link callback is a top-level
  // cross-site navigation back into the app, and `strict` would withhold the
  // cookie on that first request — the user would land signed-out and bounce
  // straight back to /login. `lax` still blocks the cross-site POST/subresource
  // cases CSRF actually needs.
  sameSite: "lax",
  // Never on localhost — dev is plain HTTP, and a `Secure` cookie there is
  // simply dropped, which reads as "login silently does nothing".
  secure: process.env.NODE_ENV === "production",
};

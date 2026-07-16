/**
 * Reads the Supabase session cookie's expiry WITHOUT any network call.
 *
 * Why this exists (owner report, recurring: "/messages sits on the F loader
 * after an iOS PWA back-swipe, and a browser refresh feels like it's logging
 * me in again"): middleware is the ONLY place in the request pipeline that can
 * persist a rotated refresh token, because a Server Component structurally
 * cannot write cookies (see createClient()'s `setAll` catch in ./server.ts).
 * Supabase rotates refresh tokens single-use, so any refresh that happens in a
 * Server Component is burned the moment it succeeds — the new token exists only
 * in that render's memory, while the browser keeps sending the old one. The
 * next request then gets `AuthApiError: Invalid Refresh Token`, which reads as
 * "signed out" and bounces the user through /login.
 *
 * Middleware therefore has to decide "does this request need a refresh?" — but
 * asking Supabase costs a network round-trip on the critical path of every
 * document load, which is the latency the owner feels. The session cookie
 * already carries `expires_at`, so that question can be answered locally, for
 * free, and the round-trip spent only when a refresh is genuinely due.
 *
 * SECURITY: the value returned here comes from a client-controlled cookie and
 * is NOT authenticated — it is only ever used to decide WHETHER TO REFRESH,
 * never who the user is or what they may access. Forging an `expires_at` far in
 * the future buys an attacker nothing: it only skips a token refresh, and every
 * guarded route plus every page's own `getUserBounded()` still verifies the
 * user against the auth server. Treat it as a hint, never as a credential.
 */

const BASE64_PREFIX = "base64-";

/** Only the session cookie itself: `sb-<ref>-auth-token`, or its `.0`/`.1`
 *  chunks. Deliberately excludes `sb-<ref>-auth-token-code-verifier` (the PKCE
 *  verifier), which also contains "-auth-token" but holds no session. */
const SESSION_COOKIE = /-auth-token(\.\d+)?$/;

/**
 * base64url → decoded UTF-8 string, matching @supabase/ssr's own
 * `stringFromBase64URL`. Hand-rolled because middleware runs on the Edge
 * runtime (no `Buffer`) and ssr's helper isn't a public export. `atob` +
 * `TextDecoder` are both Edge-safe; going through the byte array (rather than
 * using atob's output directly) is what keeps non-ASCII profile data — an
 * accented display name, an emoji — from corrupting the parse.
 */
function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * The session's access-token expiry (epoch SECONDS), or `null` if it can't be
 * determined — no cookie, an unreadable/foreign format, a future encoding
 * change. `null` always means "don't know", and every caller must treat that as
 * "do the full, authoritative check": being wrong here must cost a round-trip,
 * never correctness.
 */
export function readSessionExpiry(cookies: { name: string; value: string }[]): number | null {
  try {
    const parts = cookies
      .filter((c) => SESSION_COOKIE.test(c.name))
      // Chunk order is significant — `.10` must follow `.9`, not `.1`.
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (parts.length === 0) return null;

    // The `base64-` prefix is applied to the whole value BEFORE chunking, so
    // the chunks are joined first and the prefix stripped from the result.
    const raw = parts.map((c) => c.value).join("");
    const json = raw.startsWith(BASE64_PREFIX) ? decodeBase64Url(raw.slice(BASE64_PREFIX.length)) : raw;
    const session: unknown = JSON.parse(json);
    const expiresAt = (session as { expires_at?: unknown })?.expires_at;
    return typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

/**
 * Whether the access token has enough life left that NOTHING downstream will
 * try to refresh it — i.e. middleware can safely skip the auth round-trip.
 *
 * The margin must stay comfortably ABOVE auth-js's own `EXPIRY_MARGIN_MS`
 * (90s — `AUTO_REFRESH_TICK_THRESHOLD * AUTO_REFRESH_TICK_DURATION_MS` in
 * @supabase/auth-js/lib/constants), because that is the threshold at which a
 * Server Component's `getUser()` would decide to refresh on its own — the exact
 * unpersistable refresh this whole mechanism exists to prevent. 150s leaves a
 * 60s cushion for clock skew and slow requests: if this says "fresh", the page
 * provably won't refresh.
 */
const REFRESH_SKEW_SECONDS = 150;

export function sessionIsComfortablyFresh(cookies: { name: string; value: string }[]): boolean {
  const expiresAt = readSessionExpiry(cookies);
  if (expiresAt === null) return false;
  return expiresAt - Date.now() / 1000 > REFRESH_SKEW_SECONDS;
}

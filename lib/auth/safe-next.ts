/**
 * The one check for a "?next=" destination after signing in (2026-10-11).
 *
 * Before this, /login, /login/mfa-challenge, the auth callback and the auth panel
 * all used `next` as given. `/login?next=@evil.com` made the callback redirect to
 * `https://frenzsave.com@evil.com` — which a browser reads as the host evil.com —
 * and `?next=https://evil.com` went straight there from the login page. An open
 * redirect behind a real sign-in page is a phishing tool.
 *
 * Only a same-site PATH is accepted: it starts with a single "/", never "//" or
 * "/\" (both mean another host to a browser), carries no control characters or
 * backslashes, and is a sensible length. Anything else falls back.
 */
export function safeNext(raw: string | null | undefined, fallback = "/home"): string {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim();
  if (!v || v.length > 512) return fallback;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(v)) return fallback;
  // a path the URL parser keeps on our own host, and nothing else
  try {
    const u = new URL(v, "https://frenzsave.invalid");
    if (u.host !== "frenzsave.invalid") return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}

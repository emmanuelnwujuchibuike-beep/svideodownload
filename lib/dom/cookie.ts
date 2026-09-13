/**
 * `document.cookie`, guarded.
 *
 * ── 🔴 THE CRASH THIS EXISTS TO KILL (owner, 2026-09-13) ───────────────────
 *
 * "I went to see the site on AdSense; it shows this when scanning the site" —
 * with a screenshot of the AdSense auto-ads preview rendering our LAST-RESORT
 * boundary: "Something went wrong. Frenz hit an unexpected error."
 *
 * Reproduced exactly (scratch probe, production HTML in a sandboxed iframe):
 *
 *   Root layout error: SecurityError: Failed to read the 'cookie' property
 *   from 'Document': The document is sandboxed and lacks the
 *   'allow-same-origin' flag.
 *
 * Google's preview — and any sandboxed or storage-partitioned embed — gives the
 * page an OPAQUE origin. There `document.cookie` does not return "" — it
 * THROWS, on read and on write. A read inside a `useState` initializer or a
 * module body therefore aborts the render of the root layout, and the whole
 * site becomes the boundary above. From AdSense's side, a site that renders a
 * "something went wrong" screen to their crawler is a site with nothing on it.
 *
 * Every write in the app was already wrapped in try/catch; the READS were not,
 * because a read "cannot fail". It can. So every read goes through here, and
 * the value of "no cookies available" is an empty jar — the same thing a
 * first-ever visitor has — not an exception.
 *
 * Kept dependency-free and tiny: it is imported by the landing's cold-entry
 * chunks, which have a byte budget.
 */

/** The whole cookie string, or "" when cookies are unavailable or forbidden. */
export function readCookieJar(): string {
  if (typeof document === "undefined") return "";
  try {
    return document.cookie || "";
  } catch {
    return "";
  }
}

/** The decoded value of one cookie, or null when it is absent or unreadable. */
export function readCookie(name: string): string | null {
  const jar = readCookieJar();
  if (!jar) return null;
  const m = jar.match(new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`));
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Writes one raw `Set-Cookie`-style string. Returns whether the write was
 * allowed — a sandboxed document refuses it, and callers that keep a
 * localStorage backup (app mode, language) use the answer to know the cookie
 * did not stick.
 */
export function writeCookie(raw: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    document.cookie = raw;
    return true;
  } catch {
    return false;
  }
}

/**
 * The signed-in EXPERIENCE MODE (owner, 2026-08-02).
 *
 *  • "full"       — Full Bleed: the complete site (social + downloads). The
 *                   DEFAULT, so every existing user is unchanged.
 *  • "downloader" — the landing / downloader surfaces as a personalized home,
 *                   with social WRITE features (chatting, uploading from the
 *                   gallery) gated behind a switch back to Full Bleed. Sharing a
 *                   download, likes, views and comments all still work.
 *
 * The profile page is identical in both modes.
 *
 * The mode lives in a single cookie so it is the ONE source of truth readable by
 * BOTH the edge middleware (which decides whether `/` is the home) and the client
 * chrome — no request-time DB read, no global navigation runtime.
 */
export type AppMode = "full" | "downloader";

/** Cookie name — readable by middleware (server) and `document.cookie` (client). */
export const APP_MODE_COOKIE = "frenz_mode";

export function normalizeMode(v: string | null | undefined): AppMode {
  return v === "downloader" ? "downloader" : "full";
}

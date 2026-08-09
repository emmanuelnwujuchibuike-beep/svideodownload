/**
 * The signed-in EXPERIENCE MODE (owner, 2026-08-02).
 *
 *  • "full"       — Full Bleed: the complete site (social + downloads).
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

/**
 * DOWNLOADER is the default (owner, 2026-08-09): "let the default experience
 * mode be downloader mode, so any new user who signs in first lands on
 * Downloader mode on the Download page, not the profile page."
 *
 * So an ABSENT or unrecognised cookie means downloader, and only the explicit
 * string "full" opts into Full Bleed. That is the right way round for this
 * product: people arrive to download something, and the social side is what
 * they discover afterwards — landing a first-time member in a social feed asks
 * them to understand a whole app before they get the thing they came for.
 *
 * Note this also moves existing members who never touched the switch, since
 * "no cookie" previously meant Full Bleed. That is the intended reading of a
 * global default, and it is one tap to change: the mode switcher sits on their
 * own profile and writes the cookie explicitly.
 */
export function normalizeMode(v: string | null | undefined): AppMode {
  return v === "full" ? "full" : "downloader";
}

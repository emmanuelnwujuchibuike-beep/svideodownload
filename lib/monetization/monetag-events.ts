/**
 * The window events the app's own overlays dispatch for the flow moments it
 * already owns (a download finishing, an HD reward), which `MonetagPlacements`
 * listens for.
 *
 * ── Why this is its own tiny module ───────────────────────────────────────────
 *
 * `download-complete-ad` and `rewarded-ad` render inside the homepage downloader,
 * so anything they import is in the landing bundle the 2-second budget guards.
 * Importing these two strings from the full `monetag.ts` dragged its surface
 * matchers, placement registry and arrays onto the landing page and pushed it over
 * the ceiling. Two constants live here instead — the overlays import only this.
 */
export const MONETAG_MOMENT_EVENTS = {
  download_complete: "frenz:monetag:download-complete",
  rewarded: "frenz:monetag:rewarded",
} as const;

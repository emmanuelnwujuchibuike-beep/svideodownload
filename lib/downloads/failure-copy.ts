/**
 * The two sentences a member reads when a link cannot be served.
 *
 * ── Owner, 2026-09-13 ───────────────────────────────────────────────────────
 *
 *   "I don't like this kind of error message that says couldn't fetch this
 *    video may be private or regional locked, it should be: oops looks like
 *    your link can not be served at the moment, try again later or upgrade to
 *    pro to download all restricted videos."
 *
 *   "I want failed error 502 download shows this error message instead:
 *    error 502 failed, upgrade to pro to download all restricted videos."
 *
 * Both live here, and nowhere else, because the metadata route (server) and
 * the download card (client) each used to carry their own sentence and the
 * two had drifted — the route said "may be private, region-locked… Instagram,
 * Facebook need cookies", the card said "HTTP 502". One file, two constants,
 * imported by both. No logic, so it is safe on either side of the network.
 *
 * ⚠️ What "upgrade to Pro" promises here is a PRODUCT decision, not something
 * the pipeline enforces today: `server/extractors/index.ts` runs the same
 * direct → yt-dlp → proxy chain for every plan. Keep that in mind before
 * gating anything on this sentence.
 */

/** Metadata could not be extracted — the link failed every extractor. */
export const LINK_NOT_SERVABLE_MESSAGE =
  "Oops — looks like your link can't be served at the moment. Try again later, or upgrade to Pro to download all restricted videos.";

/** The download request itself answered 502, after the automatic retries. */
export const DOWNLOAD_502_MESSAGE =
  "Error 502: download failed. Upgrade to Pro to download all restricted videos.";

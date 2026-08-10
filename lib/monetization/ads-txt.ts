/**
 * `/ads.txt` — building the authorised-sellers file, and never losing it.
 *
 * ── The failure this exists for (owner, 2026-08-10) ──────────────────────────
 * AdSense reported "Ads.txt status: Not found" for frenzsave.com against a
 * setting the operator had already saved, and the file served perfectly when
 * fetched by hand. Both facts were true at once, and the route explains why:
 *
 *   const settings = await getMonetizationSettings();
 *   if (!settings.adsTxt.trim()) return 404;
 *
 * `getMonetizationSettings()` catches every error and returns the DEFAULTS, in
 * which `adsTxt` is the empty string. So a transient Supabase failure — a cold
 * lambda with an empty cache, a dropped connection, a brief outage — is
 * indistinguishable from "the operator has not configured this", and the route
 * turns both into a confident 404.
 *
 * That is the worst possible answer. A 4xx tells a crawler the file
 * AUTHORITATIVELY does not exist, and Google records that verdict for days
 * before re-checking. One unlucky second of database trouble costs a week of
 * ads.txt status, in a state that blocks approval and is invisible from our
 * side because every manual check afterwards succeeds.
 *
 * Two changes, both here:
 *
 * 1. DERIVE the AdSense record instead of depending on a pasted string. If a
 *    publisher id is configured, `google.com, pub-…, DIRECT, f08c47fec0942fa0`
 *    is not a preference — it is a fact, with a constant Google publishes. So
 *    the file cannot go missing while AdSense is set up at all.
 *
 * 2. Let the caller distinguish "unconfigured" from "could not read", so the
 *    route can answer 503 (come back) rather than 404 (there is nothing here).
 *
 * Kept as pure functions so the string-handling is testable — the ad-network
 * side is exactly the kind of code where nobody notices a stray character
 * until a month of revenue has not happened.
 */

/**
 * Google's certification authority id. A constant of theirs, identical for
 * every AdSense publisher, which is precisely why the record can be derived.
 */
export const GOOGLE_ADS_TXT_CERT = "f08c47fec0942fa0";

/**
 * The bare `pub-…` form ads.txt requires.
 *
 * AdSense shows the id both ways and the two are not interchangeable: the
 * script tag needs `ca-pub-…` and ads.txt needs `pub-…`. Pasting the wrong one
 * into the wrong place is the most common way this whole flow fails, and it
 * fails silently, so both forms are accepted here and normalised.
 */
export function normalisePublisherId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  const match = /^(?:ca-)?(pub-\d{10,20})$/.exec(value);
  return match ? match[1]! : null;
}

/** The canonical AdSense record for a publisher id, or null if there isn't one. */
export function adsenseRecord(publisherId: string | null | undefined): string | null {
  const pub = normalisePublisherId(publisherId);
  return pub ? `google.com, ${pub}, DIRECT, ${GOOGLE_ADS_TXT_CERT}` : null;
}

/**
 * Is this publisher already declared anywhere in the operator's own text?
 *
 * Compared on the SELLER FIELDS rather than on the whole line, because the same
 * authorisation can be written many ways — extra spaces, different casing, a
 * trailing comment, `ca-pub-` instead of `pub-`. Appending a second record for
 * a publisher who is already listed is not harmful, but a duplicated line in a
 * file an operator reads is a thing they will ask about, and the answer would
 * be "we could not tell it was the same".
 */
function declares(body: string, publisherId: string): boolean {
  for (const raw of body.split(/\r?\n/)) {
    // Strip comments — everything after `#` is ignored by the spec.
    const line = raw.split("#")[0]!.trim().toLowerCase();
    if (!line) continue;
    const fields = line.split(",").map((f) => f.trim());
    if (fields.length < 3) continue;
    if (fields[0] !== "google.com") continue;
    if (normalisePublisherId(fields[1]) === publisherId) return true;
  }
  return false;
}

/**
 * The file to serve.
 *
 * The operator's own text always leads — they may authorise several networks,
 * and their ordering and comments are theirs. The AdSense record is appended
 * only when it is missing, so a hand-written file that already contains it is
 * returned untouched.
 *
 * Returns an empty string when there is genuinely nothing to say, which the
 * route turns into a 404 — an EMPTY ads.txt is a positive assertion that no
 * seller is authorised, and serving that would tell every network to stop.
 */
export function buildAdsTxt(input: {
  adsTxt?: string | null;
  adsensePublisherId?: string | null;
}): string {
  const manual = (input.adsTxt ?? "").trim();
  const pub = normalisePublisherId(input.adsensePublisherId);

  if (!pub) return manual;
  if (manual && declares(manual, pub)) return manual;

  const record = adsenseRecord(pub)!;
  return manual ? `${manual}\n${record}` : record;
}

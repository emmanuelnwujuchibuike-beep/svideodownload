import "server-only";

import type { MonetizationSettings } from "./settings";

/**
 * Offerium — credentials, readiness, and the single place a future integration
 * plugs in.
 *
 * ── Status: ADMIN SURFACE BUILT, INTEGRATION NOT BUILT ────────────────────────
 * The admin can store Offerium's public config (SDK URL, publisher id,
 * placement id) and the server can hold its secrets, but nothing here calls
 * Offerium yet and no postback is verified. That is deliberate, not an
 * oversight: implementing it needs Offerium's official publisher documentation
 * — the exact SDK URL shape, the postback parameter names, and above all the
 * signature scheme used to prove a callback really came from them. Guessing any
 * of those produces code that looks finished, passes review, and silently fails
 * (or worse, accepts forged rewards) against the live service.
 *
 * `verifyOfferiumPostback` below is the seam. When the docs arrive, that one
 * function is what gets a body; everything around it — settings, admin UI,
 * reward sessions, daily limits, download authorization — already exists.
 *
 * ── Why secrets are here and not in MonetizationSettings ──────────────────────
 * `MonetizationSettings` is a database row an admin edits, and an allowlisted
 * subset of it is served publicly by /api/ads/config. A postback signing secret
 * living in that object would be a reward-forgery primitive the moment any
 * field of it leaked or the allowlist was widened by accident. Environment
 * variables are read only in server code and never serialised into a response,
 * so that class of mistake becomes impossible rather than merely avoided.
 */

/** Server-only secrets. Never `NEXT_PUBLIC_*`, never returned to a client. */
export interface OfferiumSecrets {
  /** Authenticates OUR outbound calls to Offerium. */
  apiKey: string;
  /** Verifies INBOUND reward postbacks really came from Offerium. */
  postbackSecret: string;
}

export function getOfferiumSecrets(): OfferiumSecrets {
  return {
    apiKey: process.env.OFFERIUM_API_KEY ?? "",
    postbackSecret: process.env.OFFERIUM_POSTBACK_SECRET ?? "",
  };
}

/**
 * Whether Offerium is genuinely ready to serve a rewarded ad.
 *
 * Deliberately stricter than "the admin flipped the switch on". A master toggle
 * with an empty SDK URL, or public ids with no server secret behind them, is a
 * half-configured integration — and the failure mode of treating that as ready
 * is the worst one available: a visitor is shown "watch an ad to unlock",
 * watches nothing because no SDK loaded, and the download never arrives. Every
 * piece must be present before the flow is offered at all.
 *
 * The SDK URL must be https — an http script on an https page is blocked by the
 * browser anyway, so accepting one would only move the failure later.
 */
export function offeriumConfigured(settings: Pick<
  MonetizationSettings,
  "offerium" | "offeriumSdkUrl" | "offeriumPublisherId" | "offeriumPlacementId"
>): boolean {
  if (settings.offerium !== true) return false;
  if (!settings.offeriumPublisherId?.trim()) return false;
  if (!settings.offeriumPlacementId?.trim()) return false;

  const url = settings.offeriumSdkUrl?.trim();
  if (!url) return false;
  try {
    if (new URL(url).protocol !== "https:") return false;
  } catch {
    return false;
  }

  const { apiKey, postbackSecret } = getOfferiumSecrets();
  return apiKey.length > 0 && postbackSecret.length > 0;
}

/**
 * A short, honest description of what is missing, for the admin panel. Returns
 * an empty array when Offerium is fully configured.
 *
 * Names the specific gap rather than showing a generic "not configured": an
 * operator who has pasted three of four values needs to know which one is
 * outstanding, and "set OFFERIUM_API_KEY" is actionable where "not ready" is
 * not. Secret CONTENTS are never returned — only whether each is present.
 */
export function offeriumReadiness(settings: MonetizationSettings): string[] {
  const missing: string[] = [];
  if (!settings.offeriumSdkUrl?.trim()) missing.push("SDK URL");
  if (!settings.offeriumPublisherId?.trim()) missing.push("Publisher ID");
  if (!settings.offeriumPlacementId?.trim()) missing.push("Placement ID");

  const { apiKey, postbackSecret } = getOfferiumSecrets();
  if (!apiKey) missing.push("OFFERIUM_API_KEY (server env)");
  if (!postbackSecret) missing.push("OFFERIUM_POSTBACK_SECRET (server env)");
  return missing;
}

/**
 * 🔴 THE INTEGRATION SEAM — intentionally unimplemented.
 *
 * When Offerium's publisher docs are available, this is where their postback is
 * verified: check the signature against `postbackSecret`, confirm the
 * transaction id has not been seen before, and only then return the reward.
 *
 * It throws rather than returning `false` so a partial wiring can never be
 * mistaken for "the reward was legitimately rejected" — a caller that reaches
 * this today has a bug, and it should be loud. Nothing calls it yet.
 */
export function verifyOfferiumPostback(): never {
  throw new Error(
    "Offerium postback verification is not implemented: the official publisher " +
      "documentation (signature scheme + callback parameters) is required before " +
      "this can be written. See lib/monetization/offerium.ts.",
  );
}

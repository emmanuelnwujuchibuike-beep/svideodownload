import { MonetagClient } from "@/features/monetization/monetag-client";
import { resolveMonetagPlacements, resolveMonetagTags } from "@/lib/monetization/monetag";
import { getMonetizationSettings } from "@/lib/monetization/settings";

/**
 * The site-level Monetag loader — the owner's chosen network alongside AdSense
 * (Adsterra/PropellerAds retired, 2026-07-26).
 *
 * ── One tag per Monetag format ────────────────────────────────────────────────
 *
 * Monetag's products (Multitag, In-Page Push, Push Notifications, Vignette Banner,
 * OnClick / Popunder) are each a separate self-placing site-level script tag with
 * its own `data-zone`. This resolves ALL of them — the primary Multitag plus every
 * per-type unit configured in the admin — de-duplicated by `resolveMonetagTags`.
 * Turning the `monetag` switch off silences every one.
 *
 * ── Parsed on the server, gated on the client ─────────────────────────────────
 *
 * The snippets are PARSED here on the server (an admin free-text field rendered
 * into the page as MARKUP would be a stored-XSS primitive — same reason
 * `verificationTags` are structured, never HTML). Only a clean https script URL +
 * `data-zone` survives; a raw snippet never leaves this function.
 *
 * The parsed, safe tags are then handed to `MonetagTags`, a client component that
 * injects them ONLY for visitors who should see ads. Pro / Business are ad-free,
 * and the plan can't be read here without un-static-ing every marketing page (the
 * `/` CDN-caching defect), so the plan gate lives on the client — exactly like
 * every placed ad already does. See features/monetization/monetag-tags.tsx.
 *
 * Verification is unaffected: Monetag is verified via the service worker merged
 * into `/sw.js` (its file method) and/or a meta tag (`verificationTags`), not the
 * in-page code tag — so gating the serving script by plan costs no verification.
 */
export async function MonetagScript() {
  const settings = await getMonetizationSettings();
  const tags = resolveMonetagTags(settings);
  const placements = resolveMonetagPlacements(settings);
  if (tags.length === 0 && placements.length === 0) return null;

  return (
    <MonetagClient
      tags={tags}
      placements={placements}
      allPages={settings.monetagAllPages}
      surfaces={settings.monetagSurfaces}
    />
  );
}

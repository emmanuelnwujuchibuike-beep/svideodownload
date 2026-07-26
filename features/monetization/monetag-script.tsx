import { MonetagClient } from "@/features/monetization/monetag-client";

/**
 * Site-wide Monetag mount — the owner's network alongside AdSense (Adsterra/
 * PropellerAds retired, 2026-07-26).
 *
 * Deliberately does NO server-side settings read: the marketing pages are static
 * (ISR), so anything resolved here would be baked into the page until it
 * regenerated — the reason an admin change looked like it "didn't take". Instead it
 * renders `MonetagClient`, which fetches the fresh config from `/api/monetag` on the
 * client and injects the tags (parse-never-inject, https-only), gated by plan
 * (Pro/Business ad-free) and the owner's page scope. See monetag-client.tsx.
 */
export function MonetagScript() {
  return <MonetagClient />;
}

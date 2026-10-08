import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { parseCatalog } from "./offer";

/**
 * What the PUBLIC landing page may say about advertising — read on the server
 * when the page is (re)generated, never per visitor (Landing brief §27, §35:
 * "do not load the ad-serving engine … use cached public configuration").
 *
 * Only discovery facts: whether advertising is on, the human names of the
 * placements an admin has enabled, and a promotion that is live right now. No
 * prices (they belong to /advertise, where they are read live), no campaign, no
 * advertiser. The source is the same public `ad_catalog()` the application
 * reads, so an admin's switch reaches here too — at the page's regeneration
 * cadence, which is why the CTA always goes to /advertise for the live state.
 */
export interface PublicAdSummary {
  enabled: boolean;
  placements: string[];
  promotion: { name: string; extraDays: number; discountPercent: number } | null;
}

const OFF: PublicAdSummary = { enabled: false, placements: [], promotion: null };

/** Pure, for the test: catalog JSON → the summary. */
export function summarizeCatalog(raw: unknown, now: number = Date.now()): PublicAdSummary {
  const cat = parseCatalog(raw);
  if (!cat || !cat.settings.ads_enabled) return OFF;
  const enabledFormats = new Set(cat.formats.map((f) => f.code));
  const placements = [...new Set(cat.placements.filter((p) => enabledFormats.has(p.format_code)).map((p) => p.name.trim()).filter(Boolean))];
  const live = cat.promotions
    .filter((p) => !p.ends_at || Date.parse(p.ends_at) > now)
    .filter((p) => p.extra_days > 0 || p.discount_percent > 0)
    .sort((a, b) => b.extra_days - a.extra_days || b.discount_percent - a.discount_percent)[0];
  return {
    enabled: true,
    placements,
    promotion: live ? { name: live.name, extraDays: live.extra_days, discountPercent: live.discount_percent } : null,
  };
}

export async function getPublicAdSummary(): Promise<PublicAdSummary> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return OFF;
  try {
    const { data, error } = await createAdminClient().rpc("ad_catalog");
    return error ? OFF : summarizeCatalog(data);
  } catch {
    return OFF;
  }
}

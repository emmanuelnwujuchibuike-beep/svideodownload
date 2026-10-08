/**
 * The serving payload — ONE small JSON for the whole site, the same for every
 * visitor, built on a CDN miss and answered by the CDN for five minutes.
 *
 * It carries ad METADATA (urls, headline, window), never the media: a creative
 * is fetched by the browser from the storage CDN only when it is about to be
 * shown, so holding a 10-ad pool costs a few hundred bytes per ad, not ten
 * downloads. Placements with nothing to serve are left out entirely, so the
 * usual answer while no campaign runs is `{"v":1,"enabled":true,"placements":{}}`.
 *
 * Pure and dependency-free apart from the engine: imported by the route and the browser.
 */

import type { AdPageContext } from "./catalog";
import { eligibleForPlacement, formatRules, servableNow, type EligibleAd, type FormatRules, type ServingSnapshot } from "./eligibility";

export interface PayloadPlacement {
  format: string;
  pages: string[];
  rules: FormatRules;
  ads: EligibleAd[];
}

export interface ServingPayload {
  v: 1;
  /** the admin's global switch — false means every surface stays empty */
  enabled: boolean;
  /** the CDN bucket this answer belongs to; the browser refetches only when it changes */
  b: number;
  placements: Record<string, PayloadPlacement>;
}

export function buildServingPayload(snapshot: ServingSnapshot, bucket: number, now: number): ServingPayload {
  const enabled = !!snapshot.settings?.ads_enabled;
  const placements: Record<string, PayloadPlacement> = {};
  if (enabled) {
    for (const p of snapshot.placements) {
      const ads = eligibleForPlacement(snapshot, p.code, now);
      if (ads.length === 0) continue;
      const format = snapshot.formats.find((f) => f.code === p.format_code)!;
      placements[p.code] = { format: p.format_code, pages: p.page_scope, rules: formatRules(format, snapshot.settings!.default_slot_count), ads };
    }
  }
  return { v: 1, enabled, b: bucket, placements };
}

/** Malformed ⇒ null ⇒ the browser serves nothing (an ad surface fails EMPTY, never broken). */
export function parseServingPayload(raw: unknown): ServingPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.enabled !== "boolean" || typeof r.b !== "number" || !r.placements || typeof r.placements !== "object") return null;
  for (const p of Object.values(r.placements as Record<string, unknown>)) {
    const pl = p as Partial<PayloadPlacement> | null;
    if (!pl || !Array.isArray(pl.ads) || !Array.isArray(pl.pages) || typeof pl.rules !== "object" || pl.rules === null) return null;
  }
  return r as unknown as ServingPayload;
}

/**
 * Stage 2 in the browser: the pool a placement may show on this page now.
 * Time and page only — everything else was decided on the server.
 */
export function adsForPage(payload: ServingPayload | null, placement: string, page: AdPageContext, now: number = Date.now()): { ads: EligibleAd[]; rules: FormatRules | null } {
  const p = payload?.enabled ? payload.placements[placement] : undefined;
  if (!p) return { ads: [], rules: null };
  return { ads: p.ads.filter((ad) => servableNow(ad, p.pages, page, now)), rules: p.rules };
}

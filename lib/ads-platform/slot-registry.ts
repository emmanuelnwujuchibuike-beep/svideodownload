/**
 * THE canonical ad-slot registry — one identity per PHYSICAL ad location
 * (owner, 2026-10-08, docs/AD_PLATFORM_PART5_SLOTS_ADDENDUM.md).
 *
 *   slot      WHERE an ad appears (one container in the UI, `data-ad-slot`)
 *   provider  WHO fills it: the paid Frenzsave campaign, or the existing
 *             network zone (whose own admin rows pick AdSense, ExoClick,
 *             Adsterra, Monetag, Hilltop… — that ladder is untouched)
 *   format    HOW a paid creative is shaped (ad_formats) — not a slot
 *   placement WHAT an advertiser buys (ad_placements) — a slot can carry one
 *
 * The slot id IS the existing network zone id wherever one exists, so the
 * physical location keeps the name the operator already configures. A paid
 * placement never gets a container of its own when a compatible one exists:
 * the resolver (`resolveSlotProvider`) picks ONE provider and only that
 * provider is mounted.
 *
 * Moments (a finished download, a return to the tab, an AI save) have no
 * page box — they are full-screen overlays. Their "slot" is the moment, and
 * the rule is the same: one provider occupies it at a time.
 *
 * Pure; imported by the browser. Admin sees and orders providers through the
 * `ad_slot_provider_order` setting (served in the payload, no deploy).
 */

import type { AdPageContext } from "./catalog";

export type SlotProvider = "frenzsave" | "network";

export interface SlotSpec {
  /** canonical id — the existing network zone id where there is one */
  id: string;
  kind: "box" | "moment";
  /** the paid placement this slot carries, if any (ad_placements.code) */
  paidPlacement: string | null;
  /** the network zone that fills it today, if any */
  networkZone: string | null;
  /** content area(s) for paid page targeting; null = derive from the route */
  pages: AdPageContext[] | null;
  /** paid creative shape this box accepts: width / height ratio, ± tolerance */
  aspect: { ratio: number; tolerance: number } | null;
  /** default provider order — the admin setting overrides it per slot */
  order: SlotProvider[];
}

// Each slot in words (location, owning component, new inventory or not) and the
// network-only zones: ./slot-inventory.ts — kept out of this file, which every
// ad-carrying page loads.

const PAID_FIRST: SlotProvider[] = ["frenzsave", "network"];

/** BOX slots — a container on the page. Moment slots (overlays) live in ./slot-moments.ts, loaded only with the paid moments. */
export const AD_SLOTS: readonly SlotSpec[] = [
  { id: "top_banner", kind: "box", paidPlacement: "global_top_banner", networkZone: "top_banner", pages: null, aspect: { ratio: 10, tolerance: 0.35 }, order: PAID_FIRST },
  { id: "downloads_top", kind: "box", paidPlacement: "global_top_banner", networkZone: "bottom_banner", pages: ["download"], aspect: { ratio: 10, tolerance: 0.35 }, order: PAID_FIRST },
  { id: "under_download", kind: "box", paidPlacement: "download_page_banner", networkZone: "under_download", pages: ["download"], aspect: { ratio: 1.6, tolerance: 0.2 }, order: PAID_FIRST },
  { id: "download_result_page", kind: "box", paidPlacement: "download_result_banner", networkZone: "download_result_page", pages: ["download_result"], aspect: { ratio: 1.6, tolerance: 0.2 }, order: PAID_FIRST },
  { id: "feed_inline", kind: "box", paidPlacement: "feed_banner", networkZone: "feed_inline", pages: ["feed"], aspect: { ratio: 1.6, tolerance: 0.2 }, order: PAID_FIRST },
  { id: "reels_interstitial", kind: "box", paidPlacement: "reels_banner", networkZone: "reels_interstitial", pages: ["reels", "ai_reels"], aspect: { ratio: 1.6, tolerance: 0.2 }, order: PAID_FIRST },
  // ── genuinely new inventory (addendum §7): no compatible slot existed, the
  //    placement is sold in the advertiser catalog, the admin can switch it off
  { id: "ai_hub_card", kind: "box", paidPlacement: "ai_banner", networkZone: null, pages: ["ai"], aspect: { ratio: 1.6, tolerance: 0.2 }, order: ["frenzsave"] },
  // A square tile inside the History grid, every 4th square (owner, 2026-10-09).
  // No aspect check: the creative is cover-cropped to the tile exactly as a
  // download's thumbnail is, so any CONTENT_BANNER creative fits.
  { id: "history_grid", kind: "box", paidPlacement: "history_grid", networkZone: null, pages: ["history"], aspect: null, order: ["frenzsave"] },
];

const byId = new Map(AD_SLOTS.map((s) => [s.id, s]));
const byZone = new Map(AD_SLOTS.filter((s) => s.networkZone).map((s) => [s.networkZone!, s]));

export function slotById(id: string): SlotSpec | null {
  return byId.get(id) ?? null;
}

/** The slot an existing network zone's container is — how AdSurface finds its paid placement. */
export function slotForZone(zone: string): SlotSpec | null {
  return byZone.get(zone) ?? null;
}

/** The admin's order for a slot, if valid; otherwise the registry default. */
export function providerOrder(slot: SlotSpec, configured: Record<string, unknown> | null | undefined): SlotProvider[] {
  const raw = configured?.[slot.id];
  if (Array.isArray(raw)) {
    const valid = raw.filter((p): p is SlotProvider => p === "frenzsave" || p === "network");
    const allowed = valid.filter((p) => (p === "network" ? !!slot.networkZone : !!slot.paidPlacement));
    if (allowed.length) return [...new Set(allowed)];
  }
  return slot.order;
}

/**
 * Can a paid creative be shown in this physical box? (addendum §55)
 *
 * 🔴 0208 (owner, 2026-10-09): ANY real creative can — it is shown whole
 * (media-spec FIT_RULE: contain) with soft space around it where the shapes
 * differ, so a slot's shape no longer drops a creative from its pool. `aspect`
 * stays the slot's DISPLAY shape (the preview draws it); it is no longer a
 * filter. Only nonsense dimensions are refused. Unknown size = trust the
 * format check.
 */
export function creativeFitsSlot(_slot: SlotSpec, w: number | null, h: number | null): boolean {
  if (w == null || h == null) return true;
  return w > 0 && h > 0;
}

/**
 * Which provider occupies the slot now — the first in order that is available.
 * `network: null` means "not known yet / unknown" and counts as available, the
 * same way the network units always treated an unknown inventory. A network
 * zone that later reports EMPTY is passed as `networkEmpty`, so the next
 * provider in order gets the slot (fallback). Null = render nothing.
 */
export function resolveSlotProvider(order: readonly SlotProvider[], avail: { frenzsave: boolean; network: boolean | null; networkEmpty?: boolean }): SlotProvider | null {
  for (const p of order) {
    if (p === "frenzsave" && avail.frenzsave) return p;
    if (p === "network" && avail.network !== false && !avail.networkEmpty) return p;
  }
  return null;
}

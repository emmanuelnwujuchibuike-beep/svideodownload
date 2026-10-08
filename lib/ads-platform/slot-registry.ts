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
  /** where it is, in words (also the admin label) */
  location: string;
  kind: "box" | "moment";
  /** the existing component that owns the container */
  component: string;
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
  /** true only where no compatible slot existed (addendum §7) */
  newInventory: boolean;
}

const PAID_FIRST: SlotProvider[] = ["frenzsave", "network"];

/** Slots that can carry a paid campaign. Network-only zones are listed in `NETWORK_ONLY_ZONES`. */
export const AD_SLOTS: readonly SlotSpec[] = [
  { id: "top_banner", location: "Fixed under the header — content pages (history, academy, blog, help, SEO pages, Frenz AI pages)", kind: "box", component: "TopPageBannerAd", paidPlacement: "global_top_banner", networkZone: "top_banner", pages: null, aspect: { ratio: 10, tolerance: 0.35 }, order: PAID_FIRST, newInventory: false },
  { id: "downloads_top", location: "Sticky at the top of /downloads", kind: "box", component: "StickyTopAd", paidPlacement: "global_top_banner", networkZone: "bottom_banner", pages: ["download"], aspect: { ratio: 10, tolerance: 0.35 }, order: PAID_FIRST, newInventory: false },
  { id: "under_download", location: "Under the Download button (landing, /downloads, platform pages, home hero)", kind: "box", component: "AdSurface", paidPlacement: "download_page_banner", networkZone: "under_download", pages: ["download"], aspect: { ratio: 1.6, tolerance: 0.2 }, order: PAID_FIRST, newInventory: false },
  { id: "download_result_page", location: "Under the download result card", kind: "box", component: "ResultAd", paidPlacement: "download_result_banner", networkZone: "download_result_page", pages: ["download_result"], aspect: { ratio: 1.6, tolerance: 0.2 }, order: PAID_FIRST, newInventory: false },
  { id: "feed_inline", location: "In the social feed, every few posts", kind: "box", component: "FeedAdSlot → AdSurface", paidPlacement: "feed_banner", networkZone: "feed_inline", pages: ["feed"], aspect: { ratio: 1.6, tolerance: 0.2 }, order: PAID_FIRST, newInventory: false },
  { id: "reels_interstitial", location: "Full-screen slide after every few reels (Reels and AI Reels)", kind: "box", component: "ReelsAdSlide", paidPlacement: "reels_banner", networkZone: "reels_interstitial", pages: ["reels", "ai_reels"], aspect: { ratio: 1.6, tolerance: 0.2 }, order: PAID_FIRST, newInventory: false },
  { id: "download_complete", location: "Full-screen moment after a download finishes", kind: "moment", component: "DownloadCompleteAd + VAST download-complete", paidPlacement: "download_completed_interstitial", networkZone: "download_complete", pages: ["download", "download_result"], aspect: null, order: PAID_FIRST, newInventory: false },
  { id: "idle_interstitial", location: "Full-screen moment on return to the tab", kind: "moment", component: "IdleInterstitial", paidPlacement: "interstitial", networkZone: "idle_interstitial", pages: null, aspect: null, order: PAID_FIRST, newInventory: false },
  // ── genuinely new inventory (addendum §7): no compatible slot existed, the
  //    placement is sold in the advertiser catalog, the admin can switch it off
  { id: "ai_hub_card", location: "End of the Frenz AI hub, above the trust row — never inside a creation flow", kind: "box", component: "SelfAdSlot", paidPlacement: "ai_banner", networkZone: null, pages: ["ai"], aspect: { ratio: 1.6, tolerance: 0.2 }, order: ["frenzsave"], newInventory: true },
  { id: "stories_between", location: "Between two people's Stories in the Story viewer", kind: "moment", component: "StoryViewer → SelfStoryCard", paidPlacement: "stories_card", networkZone: null, pages: ["stories"], aspect: null, order: ["frenzsave"], newInventory: true },
  { id: "ai_save_moment", location: "Beside an AI video save (never gates it)", kind: "moment", component: "SelfMoments", paidPlacement: "ai_video_save_reward", networkZone: null, pages: ["ai", "ai_reels"], aspect: null, order: ["frenzsave"], newInventory: true },
];

/**
 * Network zones with no paid placement — kept exactly as they are (audit,
 * docs/AD_PLATFORM.md Part 5). Listed so the inventory is complete in one place.
 */
export const NETWORK_ONLY_ZONES: readonly string[] = [
  "global", "homepage_top", "result_top", "batch_download_gate", "batch_download_complete", "reward_video", "sidebar",
  "download_history_top", "download_history_bottom", "mobile_bottom_banner", "multilink_between_sources", "multilink_fetch_gate",
  "downloader_above_fetch", "landing_section_break", "multilink_above_batch", "multilink_card_inline", "download_preparing",
  "history_above_grid", "history_between_periods", "landing_under_wallpaper", "history_story_ad", "wallpaper_reward", "exit_intent_popup",
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

/** Does a paid creative fit this physical box? (addendum §55) Unknown size = trust the format check. */
export function creativeFitsSlot(slot: SlotSpec, w: number | null, h: number | null): boolean {
  if (!slot.aspect || !w || !h) return true;
  const r = w / h;
  return Math.abs(r - slot.aspect.ratio) / slot.aspect.ratio <= slot.aspect.tolerance;
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

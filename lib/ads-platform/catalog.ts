/**
 * The self-serve ad platform's fixed vocabulary (migration 0195).
 *
 * Only the NAMES live here — the code that mounts a placement has to say which
 * one it is. Every NUMBER (rotation interval, slot count, video limit, file
 * size, price, campaign length, promotion) lives in the database and reaches
 * the browser through the serving payload, so an admin change needs no deploy.
 * `catalog.test.ts` asserts these lists equal what 0195 seeds and checks.
 *
 * Pure and dependency-free: imported by client code.
 *
 * ⚠️ This is NOT `lib/monetization/ad-schema.ts`. That file is the NETWORK
 * inventory (AdSense, ExoClick, HilltopAds, Monetag) the operator configures.
 * This is the advertiser product: a paid campaign with an end date.
 */

/** Formats — how an ad is shown. Upper-case so they can never collide with a network zone id. */
export const AD_FORMAT_CODES = [
  "TOP_BANNER",
  "CONTENT_BANNER",
  "DOWNLOAD_RESULT_BANNER",
  "INTERSTITIAL",
  "DOWNLOAD_COMPLETED_INTERSTITIAL",
  "REWARD_VIDEO",
] as const;
export type AdFormatCode = (typeof AD_FORMAT_CODES)[number];

/** Placements — where an ad is shown. Seeded by 0195. An admin may add rows, so the payload accepts any code. */
export const AD_PLACEMENT_CODES = [
  "global_top_banner",
  "feed_banner",
  "reels_banner",
  "ai_banner",
  "stories_card",
  "download_page_banner",
  "download_result_banner",
  "interstitial",
  "download_completed_interstitial",
  "ai_video_save_reward",
] as const;
export type AdPlacementCode = (typeof AD_PLACEMENT_CODES)[number];

/** Page / content areas a placement or a campaign can target. `all_pages` matches every page. */
export const AD_PAGES = ["all_pages", "download", "download_result", "feed", "reels", "ai", "ai_reels", "stories"] as const;
export type AdPage = (typeof AD_PAGES)[number];
export type AdPageContext = Exclude<AdPage, "all_pages">;

export const AD_MEDIA_TYPES = ["image", "video"] as const;
export type AdMediaType = (typeof AD_MEDIA_TYPES)[number];

/**
 * Viewer events, in the order a view moves through them. An ad that was merely
 * downloaded is `loaded` — NOT an impression. `visible` = at least half of it
 * entered the viewport. `impression` = it STAYED at least half visible for one
 * continuous second (the IAB viewable rule — see `IMPRESSION_RULE`).
 */
export const AD_EVENT_TYPES = [
  "loaded",
  "visible",
  "impression",
  "click",
  "video_start",
  "video_complete",
  "interstitial_view",
  "reward_video_start",
  "reward_video_complete",
] as const;
export type AdEventType = (typeof AD_EVENT_TYPES)[number];

export const IMPRESSION_RULE = { minVisibleRatio: 0.5, minVisibleMs: 1000 } as const;

/* ─────────────────────────────── campaign status ─────────────────────────────── */

export const CAMPAIGN_STATUSES = [
  "draft",
  "awaiting_payment",
  "payment_processing",
  "paid",
  "validating",
  "active",
  "paused",
  "expired",
  "rejected",
  "cancelled",
  "removed",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * The allowed moves — the SAME map as `ad_campaign_transition_allowed` in 0195
 * (a test parses the SQL and compares). `active` is reachable from nowhere here:
 * only `activate_ad_campaign` may go there, after checking payment, advertiser,
 * creatives, placement and a free slot.
 */
export const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  draft: ["awaiting_payment", "cancelled", "removed"],
  awaiting_payment: ["draft", "payment_processing", "cancelled", "removed"],
  payment_processing: ["awaiting_payment", "cancelled", "removed"],
  paid: ["validating", "rejected", "removed"],
  validating: ["rejected", "removed"],
  active: ["paused", "expired", "removed"],
  paused: ["expired", "removed"],
  expired: ["removed"],
  rejected: ["removed"],
  cancelled: ["removed"],
  removed: [],
};

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

/** Statuses that hold a payment (and therefore a slot, while within their window). */
export const PAID_STATUSES: readonly CampaignStatus[] = ["paid", "validating", "active", "paused"];

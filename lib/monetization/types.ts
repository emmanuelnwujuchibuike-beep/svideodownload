export type BillingPlan = "free" | "pro" | "business";

/**
 * Placement ids.
 *
 * Kept in sync with `AD_ZONES` in `ad-schema.ts`, which is the runtime list the
 * admin and the validator read. `ad-slots.test.ts` pins that the two agree —
 * they drifted apart the first time a zone was added, and the symptom was a
 * placement that validated in the admin and rendered nothing on the page.
 */
export type AdZone =
  | "global"
  | "homepage_top"
  | "under_download"
  | "result_top"
  | "download_result_page"
  | "download_complete"
  | "idle_interstitial"
  | "reward_video"
  | "sidebar"
  | "bottom_banner"
  | "download_history_bottom"
  | "mobile_bottom_banner"
  | "exit_intent_popup";

export type DeviceType = "mobile" | "desktop";

/** Everything the decision engine needs to pick a revenue strategy. */
export interface RequestContext {
  plan: BillingPlan;
  device: DeviceType;
  country: string | null;
  /** Heuristic 0–1: how monetizable this visit looks (geo, referrer, repeat). */
  value: number;
  /** True if the user has (or is browsing) developer/API features. */
  isDeveloper: boolean;
}

export interface AdSlotData {
  id: string;
  zone: string;
  network: string;
  /** `pop` is gated by the `popunder` switch, which defaults off. */
  format: "display" | "native" | "adsense" | "video" | "pop";
  scriptCode: string | null;
  imageUrl: string | null;
  targetUrl: string | null;
  headline: string | null;
  width: number | null;
  height: number | null;
  /** AdSense publisher id, e.g. `ca-pub-…`. Only set for `adsense`. */
  adClient: string | null;
  /** AdSense ad unit id. Only set for `adsense`. */
  adSlotId: string | null;
  /** AdSense `data-ad-format`, e.g. `auto` or `fluid`. */
  adLayout: string | null;
  /** Whether the visitor may dismiss a waiting unit. Reward ignores this. */
  skippable: boolean;
  /** Seconds before a skip control appears. */
  skipAfterSeconds: number;
}

export interface AffiliateOffer {
  id: string;
  name: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  cta: string;
  category: string | null;
}

export type RevenueStrategy =
  | { type: "none" }
  | { type: "ad"; zone: AdZone }
  | { type: "affiliate"; offer: AffiliateOffer }
  | { type: "premium_prompt"; reason: string }
  | { type: "api_upsell" };

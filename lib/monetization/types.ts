export type BillingPlan = "free" | "pro" | "business";

export type AdZone =
  | "homepage_top"
  | "download_result_page"
  | "sidebar"
  | "exit_intent_popup"
  | "mobile_bottom_banner";

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
  format: "display" | "pop" | "native";
  scriptCode: string | null;
  imageUrl: string | null;
  targetUrl: string | null;
  headline: string | null;
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

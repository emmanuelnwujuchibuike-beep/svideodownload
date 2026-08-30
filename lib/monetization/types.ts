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
  // Batch downloads are free, paid for by these two placements: a full-screen
  // ad before the batch runs and a short one once the files are saved.
  | "batch_download_gate"
  | "batch_download_complete"
  | "reward_video"
  | "sidebar"
  | "bottom_banner"
  | "top_banner"
  | "download_history_top"
  | "download_history_bottom"
  | "mobile_bottom_banner"
  | "exit_intent_popup"
  /*
    In-feed native slot — one after every N posts in the social feed
    (2026-08-24). The server decides where these exist, in
    lib/feed/ad-slots.ts, and this zone decides only what fills them.

    🔴 The most valuable placement on the site and the most dangerous: it is
    inside an infinite scroll containing autoplaying video. Anything seeded
    here must be lightweight. A row whose script autoplays audio, or which
    pulls a heavy SDK, degrades the whole feed rather than one page — see
    features/feed/feed-ad-slot.tsx for the isolation guarantees the SLOT
    provides and cannot provide on the creative's behalf.

    ⚠️ This comment contains no semicolon, deliberately, and neither should
    any comment added to this union. `ad-slots.test.ts` recovers the member
    list by slicing the source at the first statement terminator, so one
    appearing inside a comment truncates the list early and silently drops
    every zone below it from the type/runtime agreement check.
  */
  | "feed_inline"
  /*
    Multi-Link batch downloader (2026-08-25).

    `multilink_between_sources` sits between fetch cards and takes any format.
    `multilink_fetch_gate` is the skippable vignette after a fetch action.

    ⚠️ Same rule as the note above: no semicolon anywhere in a comment inside
    this union, and no double-quoted lowercase word either — ad-slots.test.ts
    recovers the member list by slicing at the first statement terminator and
    then matching every quoted token, so either one silently corrupts the
    type/runtime agreement check.
  */
  | "multilink_between_sources"
  | "multilink_fetch_gate"
  /*
    ExoClick vertical-video placements (2026-08-30).

    Five surfaces the owner asked for by name — above the paste box, between
    every landing section, above the batch Download button, inside each
    Multi-Link source card, and one full-screen slide after every third reel.
    All five are shaped for a 9:16 creative and all five serve NOTHING until
    the ExoClick switch in monetization settings is turned on.

    ⚠️ Same rule as the two notes above and it has bitten twice already: no
    semicolon anywhere in a comment inside this union, and no double-quoted
    lowercase word either — ad-slots.test.ts recovers the member list by
    slicing at the first statement terminator and then matching every quoted
    token, so either one silently corrupts the type/runtime agreement check.
  */
  | "downloader_above_fetch"
  | "landing_section_break"
  | "multilink_above_batch"
  | "multilink_card_inline"
  | "reels_interstitial";

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
  /**
   * `pop` is gated by the `popunder` switch, which defaults off, and
   * `exoclick` by the `exoclick` switch, which also defaults off.
   */
  format: "display" | "native" | "adsense" | "video" | "pop" | "exoclick";
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

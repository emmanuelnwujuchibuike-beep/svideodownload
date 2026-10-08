/**
 * The slot registry's DESCRIPTION — where each canonical slot is, in words, the
 * existing component that owns it, and whether it is new inventory — plus the
 * network-only zones. Read by the docs, the tests and (Part 6) the admin; kept
 * apart from ./slot-registry.ts, which every ad-carrying page loads, so none of
 * this text ships to visitors.
 */

export interface SlotDescription {
  location: string;
  component: string;
  /** true only where no compatible slot existed (shared-slot addendum §7) */
  newInventory: boolean;
}

export const SLOT_DESCRIPTIONS: Readonly<Record<string, SlotDescription>> = {
  top_banner: { location: "Fixed under the header — content pages (history, academy, blog, help, SEO pages, Frenz AI pages)", component: "TopPageBannerAd", newInventory: false },
  downloads_top: { location: "Sticky at the top of /downloads", component: "StickyTopAd", newInventory: false },
  under_download: { location: "Under the Download button (landing, /downloads, platform pages, home hero)", component: "AdSurface", newInventory: false },
  download_result_page: { location: "Under the download result card", component: "ResultAd", newInventory: false },
  feed_inline: { location: "In the social feed, every few posts", component: "FeedAdSlot → AdSurface", newInventory: false },
  reels_interstitial: { location: "Full-screen slide after every few reels (Reels and AI Reels)", component: "ReelsAdSlide", newInventory: false },
  download_complete: { location: "Full-screen moment after a download finishes", component: "DownloadCompleteAd + VAST download-complete", newInventory: false },
  idle_interstitial: { location: "Full-screen moment on return to the tab", component: "IdleInterstitial", newInventory: false },
  ai_hub_card: { location: "End of the Frenz AI hub, above the trust row — never inside a creation flow", component: "SelfAdSlot", newInventory: true },
  stories_between: { location: "Between two people's Stories in the Story viewer", component: "StoryViewer → SelfStoryCard", newInventory: true },
  ai_save_moment: { location: "Beside an AI video save (never gates it)", component: "SelfMoments", newInventory: true },
};

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

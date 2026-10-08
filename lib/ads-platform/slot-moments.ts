/**
 * The MOMENT slots — full-screen overlays with no page box (a finished
 * download, a return to the tab, between two people's Stories, beside an AI
 * save). Same SlotSpec as the box slots, kept in their own module because only
 * the lazily-loaded paid moments read them; the box registry ships on every
 * ad-carrying page.
 */

import type { SlotProvider, SlotSpec } from "./slot-registry";

const PAID_FIRST: SlotProvider[] = ["frenzsave", "network"];

export const MOMENT_SLOTS: readonly SlotSpec[] = [
  { id: "download_complete", kind: "moment", paidPlacement: "download_completed_interstitial", networkZone: "download_complete", pages: ["download", "download_result"], aspect: null, order: PAID_FIRST },
  { id: "idle_interstitial", kind: "moment", paidPlacement: "interstitial", networkZone: "idle_interstitial", pages: null, aspect: null, order: PAID_FIRST },
  { id: "stories_between", kind: "moment", paidPlacement: "stories_card", networkZone: null, pages: ["stories"], aspect: null, order: ["frenzsave"] },
  { id: "ai_save_moment", kind: "moment", paidPlacement: "ai_video_save_reward", networkZone: null, pages: ["ai", "ai_reels"], aspect: null, order: ["frenzsave"] },
];

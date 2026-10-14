/**
 * 🔴 NO AD ON COMING BACK TO THE APP (owner, 2026-10-14: "Turn off the
 * interstilla that shows when a user navigates back to the app from outside").
 *
 * Three surfaces each showed a full-screen ad when the visitor returned after
 * ≥5 s away; this one switch turns all three off:
 *
 *   features/monetization/idle-interstitial.tsx     — the network unit's return trigger
 *   features/monetization/monetag-placements.tsx    — Monetag's "return" moment
 *   features/ads-platform/serve/self-moments.tsx    — our own ad platform's return interstitial
 *
 * Only the RETURN trigger: in-page idle, back-swipe and download moments are
 * untouched. Flip to `true` to bring it back.
 */
export const RETURN_INTERSTITIAL_ENABLED: boolean = false;

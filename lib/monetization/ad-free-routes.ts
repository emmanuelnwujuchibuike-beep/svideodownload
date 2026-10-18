import { isProfilePath } from "@/lib/social/profile-url";

/**
 * Pages that carry NO ads of any kind — not Google, not Hilltop, Monetag or VAST, not a paid
 * Frenzsave campaign, not a full-screen moment (owner, 2026-10-14: "ad shouldn't show in the
 * sign in page or profile page").
 *
 * `ad-policy.ts` answers a narrower question (where Google's inventory may run). This is the
 * blanket "never here" list every ad surface asks first: `useShowAds` (every in-page unit, the
 * Hilltop slider, the paid-ads gate), `monetagAllowedOnPath`, the app-wide bottom banner and
 * the VAST interstitial engine. Pure and client-safe.
 *
 * Prefixes own their subtree: `/login` covers `/login/mfa-challenge`; `/u/` covers every
 * profile, its posts tab and its card page.
 */
// signing in and up (/login, /signup, /register, /auth, /welcome, /logout) and profiles — anyone's,
// your own included (/u/…, /profile). One pattern rather than a list + loop: this ships with every
// page that can show an ad, /home among them, which sits at its route-weight ceiling.
const AD_FREE = /^\/(?:(?:login|signup|register|auth|welcome|logout|profile)(?:[/?#]|$)|u\/)/i;

export function isAdFreeRoute(pathname: string | null | undefined): boolean {
  // profiles moved to /:handle on 2026-10-17 (lib/social/profile-url.ts); /u/… above still matches old links
  return AD_FREE.test(pathname || "/") || isProfilePath(pathname);
}

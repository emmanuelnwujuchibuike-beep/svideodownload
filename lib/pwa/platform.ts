/**
 * Shared client-side platform detection for PWA install/push flows —
 * previously hand-duplicated verbatim across ios-install-prompt.tsx,
 * push-nudge.tsx, and (isIos only, as isIosDevice) lib/client-download.ts.
 */

/** True once launched from the home-screen icon (standalone display mode). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Legacy iOS Safari boolean — still the only signal on older iOS versions.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iOS Safari, incl. iPadOS 13+ which reports as "Mac" but has touch. SSR-safe. */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// In-app webviews (a link opened inside another app's own browser) don't
// expose the OS share sheet that "Add to Home Screen" lives in — tapping our
// instructions there does nothing, so those users get pointed at
// copy-the-link instead.
const IOS_IN_APP_UA =
  /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Twitter|Line\/|MicroMessenger|Snapchat|LinkedInApp|Pinterest\/[\d.]+ /i;

export function isIosInApp(): boolean {
  return isIos() && IOS_IN_APP_UA.test(navigator.userAgent);
}

/**
 * Which install-analytics platform bucket a shown install-prompt mode maps
 * to — "android" mode covers both real Android AND desktop Chrome (same
 * `beforeinstallprompt` event), so it needs the UA to tell them apart. Takes
 * the UA as an explicit parameter (rather than reading `navigator.userAgent`
 * internally) so it's testable without a DOM, matching lib/auth/device-label.ts's
 * `parseDevice` convention.
 */
export function classifyInstallPlatform(
  mode: "ios" | "ios-inapp" | "android",
  userAgent: string,
): "ios" | "ios-inapp" | "android" | "desktop" {
  if (mode !== "android") return mode;
  return /android/i.test(userAgent) ? "android" : "desktop";
}

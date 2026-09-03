"use client";

/**
 * Keeps a self-placing ad out of the PWA's top safe area.
 *
 * Owner, 2026-09-03, with a screenshot: "the monetag banner is going to the
 * safe area on pwa, and i dont want it to." Two In-Page Push cards were drawn
 * hard against the top of the installed app, under the clock and the Dynamic
 * Island, with the first card's text clipped behind the status bar.
 *
 * ── Why this moves the ad instead of hiding it ────────────────────────────────
 *
 * 🔴 Nothing here hides, removes, resizes or wraps a creative. It adds a top
 * margin so the whole card sits BELOW the status bar. That makes the ad more
 * visible, not less — an impression the network has already counted stays fully
 * on screen instead of half of it living under the notch, which is the right
 * direction for both the reader and the CPM. Suppressing a served creative is
 * the thing this codebase does not do.
 *
 * ── No selector is guessed ────────────────────────────────────────────────────
 *
 * The element is identified by `network-ad-watch.ts` the same way everything
 * else about these networks is: by WHEN it appeared (after we injected the tag)
 * and by the fact that it drew a real box. Nothing here knows or assumes a class
 * name, so a change on Monetag's side cannot turn this into a blanked ad.
 *
 * ── `margin-top`, specifically ────────────────────────────────────────────────
 *
 * Not `top`, and not `transform`. A self-placing widget commonly animates itself
 * in on one of those, and fighting its animation is how you get a creative that
 * flickers or lands in the wrong place. A margin on a `position: fixed` element
 * shifts it without participating in either.
 */

/** Only offset a node that is actually sitting in the inset region. */
const TOP_TOLERANCE_PX = 8;

/** The app's own top inset, already floored for iOS in globals.css. */
function safeAreaTopPx(): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  /*
    Installed app only. `.pwa-standalone` is the JS-set class app/layout.tsx
    puts on <html>, and globals.css uses exactly this signal — the
    `display-mode: standalone` media query did NOT reliably match in the
    installed iOS app, which is why the class exists. A browser tab is left
    completely alone, which is what the owner asked for.
  */
  if (!document.documentElement.classList.contains("pwa-standalone")) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--frenz-safe-top").trim();
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) && px > 0 ? px : 0;
}

/**
 * If `el` is a fixed element drawn into the top inset, push it below it.
 * Safe to call repeatedly on the same node; does nothing outside the PWA, and
 * nothing if the inset cannot be measured.
 */
export function keepAdBelowSafeArea(el: Element): void {
  const inset = safeAreaTopPx();
  if (inset <= 0) return;

  let cs: CSSStyleDeclaration;
  try {
    cs = getComputedStyle(el);
  } catch {
    return; // detached mid-callback
  }
  if (cs.position !== "fixed" && cs.position !== "absolute") return;

  const rect = el.getBoundingClientRect();
  // Already clear of the status bar — a bottom-anchored or centred creative
  // must not be nudged for no reason.
  if (rect.top > inset - TOP_TOLERANCE_PX) return;
  // A full-height overlay is not a banner in the inset; offsetting it would
  // just push its bottom edge off screen.
  if (rect.height >= window.innerHeight * 0.9) return;

  const style = (el as HTMLElement).style;
  if (style.getPropertyValue("--frenz-ad-inset") === "1") return; // already done
  style.setProperty("--frenz-ad-inset", "1");
  style.setProperty("margin-top", `${Math.round(inset)}px`, "important");
}

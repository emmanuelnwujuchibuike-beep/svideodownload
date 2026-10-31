"use client";

import { useEffect } from "react";

/**
 * Coming back to the installed app never leaves the page pulled down (owner, 2026-10-31: "when I leave the pwa the top
 * section of the feed and friends page get pulled down giving too much white space").
 *
 * The 2026-10-29 fix dropped a pull-to-refresh that the system cancelled, but the gap kept coming back: the floating
 * buttons (fixed) stayed where they belong while everything that scrolls sat lower. That is iOS freezing the document
 * MID-OVERSCROLL — leaving with the home swipe while the page is still bouncing — and resuming it with that elastic
 * offset baked in until the next touch. On return this settles the document back onto its real scroll position (a
 * scroll to where it already is ends the bounce), and drops a banner reservation whose banner isn't on the page.
 *
 * Two listeners, no timer, nothing on the first paint (it rides the shell's deferred island).
 */
export function ResumeSettle() {
  useEffect(() => {
    const settle = () => {
      requestAnimationFrame(() => {
        const y = Math.max(0, window.scrollY);
        window.scrollTo({ top: y, left: 0, behavior: "instant" as ScrollBehavior });
        const root = document.documentElement;
        // a reservation whose banner is gone (unmounted while the app slept) is a gap with nothing in it
        if (!document.querySelector('[role="status"][style*="--frenz-header-bottom"]') && root.style.getPropertyValue("--frenz-announce-h") !== "0px") {
          root.style.setProperty("--frenz-announce-h", "0px");
        }
        if (!document.querySelector('[data-ad-slot="top_banner"]:not(.hidden)') && root.style.getPropertyValue("--frenz-topbanner-h") !== "0px") {
          root.style.setProperty("--frenz-topbanner-h", "0px");
        }
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") settle();
    };
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) settle();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);
  return null;
}

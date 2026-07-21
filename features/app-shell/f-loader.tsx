"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

/**
 * A full-screen F loader identical to the cold-start BootSplash — it reuses that
 * splash's GLOBAL `.frenz-boot__mark` / `.frenz-boot__shine` animation classes
 * (injected once in <head> by BootHead, see boot-splash.tsx) and the same
 * theme-aware background, so the two are pixel-for-pixel the same mark.
 *
 * Why it exists: the login hand-off. A successful sign-in used to show the auth
 * panel's OWN "verifying / you're in" state and THEN, after the navigation, a
 * separate F boot splash on /home — two different loaders for one login (owner,
 * 2026-07-21: "the login shows two different loaders when a user logs in, I want
 * one"). AuthPanel renders this the instant a sign-in succeeds and sets the
 * `frenz_just_signed_in` cookie, so the very same F mark stays on screen from the
 * tap, through the full-document navigation, into the BootSplash that renders on
 * the destination — one continuous branded loader.
 *
 * It does NOT dismiss itself: it's shown only while the page is on its way to a
 * `window.location.assign()`, so the outgoing document is torn down (taking this
 * with it) and the destination's own BootSplash takes over. The 6s BootSplash
 * failsafe on the destination still bounds the worst case.
 */
export function FLoaderOverlay() {
  // Portals need a DOM target; mount after hydration so SSR and the first client
  // render agree (this is only ever shown in response to a click, never on the
  // server-rendered first paint).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      aria-hidden
      // Same stacking context and background as #frenz-boot in boot-splash.tsx —
      // covers the auth panel, the back button, and the ambient washes.
      className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-background"
    >
      <span className="frenz-boot__mark">
        {/* eslint-disable-next-line @next/next/no-img-element -- matches BootSplash's
            raw <img>; the asset is preloaded in <head> so it paints immediately */}
        <img src="/brand/frenz-logo-splash.png" width={152} height={152} alt="" />
        <span className="frenz-boot__shine" />
      </span>
    </div>,
    document.body,
  );
}

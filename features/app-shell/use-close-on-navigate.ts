"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A FULL-SCREEN VIEWER CLOSES WHEN YOU NAVIGATE AWAY FROM IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "Bottom NAV doesn't remove the profile video view unless I
 * click the X at the top left corner, bottom nav should be able to exit the
 * video or image viewer."
 *
 * ── Why it happened ─────────────────────────────────────────────────────────
 *
 * These viewers are OVERLAYS, not routes. They are state on the page that
 * opened them, so a tap on the bottom nav did exactly what it promised — it
 * navigated — and the overlay, being state rather than a route, stayed mounted
 * on top of wherever you had just gone. The X worked because the X is the only
 * thing that had ever been wired to `onClose`.
 *
 * ── Why a hook rather than a fix in each viewer ─────────────────────────────
 *
 * There are at least three (image, reel, post) and every future one has the
 * same obligation. A rule that has to be re-remembered per component is a rule
 * that will be missed by the fourth one.
 *
 * ── 🔴 THE FIRST PATHNAME IS NOT A NAVIGATION ───────────────────────────────
 *
 * The pathname is read once on mount and kept; `onClose` fires only when a
 * LATER render reports a different one. Without that the viewer would close
 * itself on the very first commit and never open at all — which is the obvious
 * way to write this and the reason it is written down.
 *
 * `onClose` is held in a ref so a caller passing an inline arrow (all of them
 * do) does not re-run this effect on every render and re-arm the comparison.
 */
export function useCloseOnNavigate(onClose: () => void): void {
  const pathname = usePathname();
  const openedAt = useRef(pathname);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (pathname === openedAt.current) return;
    close.current();
  }, [pathname]);
}

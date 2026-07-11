"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { isBodyScrollLocked } from "@/lib/dom/scroll-lock";
import { isStandalone } from "@/lib/pwa/platform";

const EDGE_ZONE_PX = 24; // matches iOS's own narrow edge-gesture hit zone
const SWIPE_THRESHOLD_PX = 80;

/**
 * Standalone PWAs get NO back gesture at all: iOS's edge-swipe-to-go-back
 * only exists within Safari's own browser chrome, which an installed
 * home-screen app doesn't have — there is no other way to go "back" besides
 * an in-page button. This restores it: a touch starting within the left
 * edge zone that drags right past the threshold calls `router.back()`.
 *
 * Passive, never calls preventDefault (same proven-safe pattern as
 * PullToRefresh) so it never fights a component's own touch handling
 * underneath — and explicitly backs off while a fullscreen viewer/modal is
 * open, via `isBodyScrollLocked()` (lib/dom/scroll-lock.ts) rather than
 * inventing new coordination state.
 */
export function EdgeSwipeBack() {
  const router = useRouter();
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!isStandalone()) return;

    const onTouchStart = (e: TouchEvent) => {
      if (isBodyScrollLocked()) {
        start.current = null;
        return;
      }
      const t = e.touches[0];
      start.current = t && t.clientX <= EDGE_ZONE_PX ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const from = start.current;
      start.current = null;
      if (!from) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - from.x;
      const dy = Math.abs(t.clientY - from.y);
      if (dx > SWIPE_THRESHOLD_PX && dy < dx) router.back();
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [router]);

  return null;
}

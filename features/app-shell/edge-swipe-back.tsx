"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { takeBackTarget } from "@/lib/dom/back-target";
import { isBodyScrollLocked } from "@/lib/dom/scroll-lock";
import { isStandalone } from "@/lib/pwa/platform";

/**
 * Exported so other horizontal-swipe gestures (e.g. reel-viewer's own For You
 * / Following tab switch) can exclude this same strip and avoid interpreting
 * the identical touch this component already claims for back-navigation.
 */
export const EDGE_ZONE_PX = 24; // matches iOS's own narrow edge-gesture hit zone
/** Past this much horizontal travel, releasing completes the navigation. */
const SWIPE_THRESHOLD_PX = 80;
/** Below this, a mostly-vertical drag is a scroll and the page must not move. */
const DIRECTION_LOCK_PX = 10;
/** How long the page takes to finish leaving once the gesture is released. */
const COMPLETE_MS = 220;
/** How long it takes to snap back when the gesture is abandoned. */
const CANCEL_MS = 190;

/**
 * The iOS-style edge-swipe back gesture, with the page following the finger.
 *
 * Standalone PWAs get NO back gesture at all: iOS's edge-swipe-to-go-back only
 * exists within Safari's own browser chrome, which an installed home-screen app
 * does not have. This restores it.
 *
 * ── 🔴 WHY THIS FELT ARTIFICIAL, AND WHAT CHANGED (owner, 2026-08-24) ──────
 * "the pages transition and backswipe of pages... is too heavy and feels slow,
 * more fast and light weight like exact a real native mobile app, not like an
 * artificial framer motion. it should be exact like a native fast app, without
 * a delay."
 *
 * The previous version listened for `touchstart` and `touchend` and NOTHING in
 * between. Dragging produced no movement whatsoever; the page only reacted
 * after the finger lifted, and then played a 520ms slide. So the gesture had
 * two defects that compound:
 *
 *   1. NO FOLLOW-THROUGH. A native back-swipe is direct manipulation — the page
 *      is attached to your thumb and tracks it 1:1, and you can see how far you
 *      have to go before it commits. Without that it is not a gesture at all,
 *      it is a swipe-shaped button, and the animation afterwards reads as an
 *      unexplained delay because nothing connected it to what you did.
 *   2. IT WAS THE SLOWEST PART OF THE APP. Half a second of movement after the
 *      gesture had already ended.
 *
 * Note what was NOT the cause: framer-motion. Page transitions have always been
 * plain CSS keyframes (globals.css). The heaviness was duration and the missing
 * drag, not the animation library.
 *
 * ── Why direct DOM writes and not React state ──────────────────────────────
 * The transform is written straight to `element.style` on every touchmove. A
 * `useState` per frame would re-render the entire page subtree sixty times a
 * second during the gesture — on a feed full of video that is precisely the
 * jank being complained about. This way React does not participate at all: the
 * only work per frame is one style write the compositor consumes.
 *
 * Listeners stay PASSIVE and never call `preventDefault` (the same proven-safe
 * pattern as PullToRefresh), so this can never fight a component's own touch
 * handling underneath. A direction lock means a vertical scroll that happens to
 * begin near the edge is left completely alone.
 *
 * 🔴 The transform is ALWAYS cleared when the gesture ends. A lingering
 * transform makes the wrapper a containing block for `position: fixed`
 * descendants — the documented cause of the chat overlay being sized to the
 * content column and the nav showing through it (see page-transition.tsx).
 */
export function EdgeSwipeBack() {
  const router = useRouter();
  const pathname = usePathname();
  const start = useRef<{ x: number; y: number } | null>(null);
  const el = useRef<HTMLElement | null>(null);
  /** null = undecided, true = horizontal (ours), false = vertical (theirs). */
  const horizontal = useRef<boolean | null>(null);
  /**
   * SINGLE-SHOT LOCK (owner, 2026-08-26: "full backswipe go two times back
   * ... swiping fully on ios screen goes twice or three time back ... unless
   * backswipe half screen and slightly thats when it goes back once and
   * normal").
   *
   * A full, fast edge-to-edge swipe travels exactly the distance and speed
   * that can make iOS's OWN edge-gesture recognizer -- the one this file's
   * EDGE_ZONE_PX comment already notes iOS reserves near the screen edge --
   * treat the touch as ambiguous, touchcancel it mid-drag, and redeliver a
   * fresh touchstart/touchend cycle once it decides not to claim it. A short,
   * unhurried "half screen" swipe never reaches whatever threshold makes iOS
   * do that, which is exactly the reported correlation: distance and speed,
   * not anything this code computes differently per gesture.
   *
   * finish()'s existing guard (checking start.current) only protects against
   * RE-ENTRY of the same cycle -- it does nothing to stop a genuinely NEW
   * touchstart that iOS redelivers while a previous commit is still
   * resolving. This lock closes that gap directly: once a swipe COMMITS,
   * every touch is ignored -- however many cycles iOS sends -- until the
   * route actually changes (proof the first commit's navigation completed),
   * or a generous safety-net timeout in case navigation didn't change the
   * URL at all (e.g. router.back() with nowhere to go).
   */
  const committing = useRef(false);
  useEffect(() => {
    committing.current = false;
  }, [pathname]);

  useEffect(() => {
    if (!isStandalone()) return;

    /** Put the wrapper back exactly as it was found. */
    const release = (transition: string | null, transform: string | null) => {
      const node = el.current;
      if (!node) return;
      node.style.transition = transition ?? "";
      node.style.transform = transform ?? "";
      if (!transition && !transform) {
        // Fully at rest — drop the properties entirely rather than leaving
        // empty strings, so no stale containing block can survive.
        node.style.removeProperty("transition");
        node.style.removeProperty("transform");
        node.style.removeProperty("will-change");
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      // A prior swipe already committed a navigation and hasn't resolved yet
      // -- ignore every touch, including one iOS redelivers for the SAME
      // physical gesture, so it can never schedule a second commit.
      if (committing.current) {
        start.current = null;
        return;
      }
      horizontal.current = null;
      if (isBodyScrollLocked()) {
        start.current = null;
        return;
      }
      const t = e.touches[0];
      if (!t || t.clientX > EDGE_ZONE_PX) {
        start.current = null;
        return;
      }
      start.current = { x: t.clientX, y: t.clientY };
      // Resolved at gesture START, once: querying per frame would be a DOM
      // lookup sixty times a second for an element that cannot change mid-drag.
      el.current = document.querySelector<HTMLElement>("[data-page-transition]");
    };

    const onTouchMove = (e: TouchEvent) => {
      const from = start.current;
      const node = el.current;
      if (!from || !node) return;
      const t = e.touches[0];
      if (!t) return;

      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;

      if (horizontal.current === null) {
        // Not enough travel to tell yet — stay out of the way.
        if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
        horizontal.current = Math.abs(dx) > Math.abs(dy);
        if (!horizontal.current) {
          // It is a scroll. Hand it back untouched and take no further part.
          start.current = null;
          return;
        }
        // Promote once, for the duration of the drag only.
        node.style.willChange = "transform";
        node.style.transition = "none";
      }

      // Only ever rightward, and never past the screen: pulling left would drag
      // the page off the wrong edge, and there is nothing beyond 100%.
      const travel = Math.max(0, Math.min(dx, window.innerWidth));
      node.style.transform = `translate3d(${travel}px, 0, 0)`;
    };

    const finish = (e: TouchEvent) => {
      const from = start.current;
      const node = el.current;
      start.current = null;
      const wasHorizontal = horizontal.current === true;
      horizontal.current = null;
      if (!from || !node || !wasHorizontal) {
        el.current = null;
        return;
      }

      const t = e.changedTouches[0];
      const dx = t ? t.clientX - from.x : 0;
      const commit = dx > SWIPE_THRESHOLD_PX;

      if (commit) {
        // Locked BEFORE the setTimeout below, not inside it -- the
        // redelivered touch this guards against can arrive within
        // milliseconds, well before COMPLETE_MS elapses.
        committing.current = true;
        // Safety net: if the route never actually changes (nothing to go
        // back to, or takeBackTarget points at the current page), the
        // pathname-driven unlock above never fires. 1500ms comfortably
        // covers COMPLETE_MS (220) plus a full page-transition, so a
        // genuinely new swipe on the same page is never locked out longer.
        window.setTimeout(() => {
          committing.current = false;
        }, 1500);
        /*
          Carry the page the rest of the way out, THEN navigate. Navigating
          first would swap the content underneath a wrapper that is still
          mid-transform, so the incoming page would appear already pushed
          aside — which is the visual glitch that makes a swipe-back look
          broken. The two are sequenced instead of raced.
        */
        node.style.transition = `transform ${COMPLETE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        node.style.transform = `translate3d(${window.innerWidth}px, 0, 0)`;
        window.setTimeout(() => {
          release(null, null);
          el.current = null;
          /*
            🔴 A PAGE MAY OVERRIDE WHERE "BACK" GOES (owner, 2026-08-24:
            "backswipe from chat goes back to home feed, instead of to message
            page"). A chat opened via `/messages/new/<userId>` arrives through a
            SERVER redirect, which replaces the history entry — so there is no
            inbox behind the thread and `back()` was correctly returning to
            whatever came before, usually the home feed.

            `replace`, not `push`: the chat entry becomes the inbox, so history
            stays chat→inbox→wherever-you-were instead of growing a loop where
            backing out of the inbox returns to the chat you just left. It is a
            client navigation either way, so nothing reloads.

            `takeBackTarget()` consumes the value, so the very next gesture
            falls back to real history — an override is for one navigation, not
            a mode.
          */
          const target = takeBackTarget();
          if (target) router.replace(target);
          else router.back();
        }, COMPLETE_MS);
        return;
      }

      // Abandoned — snap home. Faster than the commit, because an undo should
      // feel dismissive rather than deliberate.
      node.style.transition = `transform ${CANCEL_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      node.style.transform = "translate3d(0, 0, 0)";
      window.setTimeout(() => {
        release(null, null);
        el.current = null;
      }, CANCEL_MS);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", finish, { passive: true });
    window.addEventListener("touchcancel", finish, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", finish);
      window.removeEventListener("touchcancel", finish);
      // A gesture interrupted by unmount must not leave the wrapper transformed.
      release(null, null);
    };
  }, [router]);

  return null;
}

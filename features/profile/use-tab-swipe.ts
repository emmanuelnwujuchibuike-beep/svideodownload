"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Sideways swipe between the profile's sections (owner, 2026-10-19: "swipe left or right to navigate to
 * the post, reels, collection and exclusive … smooth and instant, no loading … like they're all in one page").
 *
 * The finger moves the section itself — no React render per frame: the track's transform is written straight
 * to the element. The section beside it is ALREADY mounted (the caller keeps visited sections and the two
 * neighbours mounted, hidden), so what slides in is the real content, not a spinner.
 *
 * - The direction locks after 10 px: a vertical drag is the page scroll and this lets go of it.
 * - A drag that starts inside something that scrolls sideways (a chip row, a carousel) belongs to that.
 * - A touch that starts in the left-edge strip belongs to the platform's back gesture — two gestures claiming
 *   one touch was the "back goes twice" incident (2026-10-07).
 * - Past a quarter of the width, or a quick flick, it commits; otherwise it springs back.
 */
const LOCK_PX = 10;
const EDGE_PX = 24;
const COMMIT_RATIO = 0.25;
const FLICK_PX_PER_MS = 0.45;
const SETTLE_MS = 220;

function scrollsSideways(el: Element | null, stop: Element): boolean {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}

export function useTabSwipe({
  region,
  track,
  prev,
  next,
  onCommit,
  onIntent,
  active,
}: {
  region: RefObject<HTMLDivElement | null>;
  track: RefObject<HTMLDivElement | null>;
  prev: string | null;
  next: string | null;
  /** Called with the section that slid fully in. */
  onCommit: (key: string) => void;
  /** A finger landed: mount the neighbours now, so they are drawn before the drag reaches them. */
  onIntent: () => void;
  active: string;
}) {
  /** The neighbour being dragged into view — shown beside the active section while the finger is down. */
  const [peek, setPeek] = useState<{ key: string; side: "left" | "right" } | null>(null);
  const latest = useRef({ prev, next, onCommit, onIntent });
  latest.current = { prev, next, onCommit, onIntent };

  useEffect(() => {
    const el = region.current;
    if (!el) return;
    let start: { x: number; y: number; t: number } | null = null;
    let axis: "h" | "v" | null = null;
    let dx = 0;
    let target: string | null = null;
    let settling = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const move = (x: number, animate: boolean) => {
      const t = track.current;
      if (!t) return;
      t.style.transition = animate && !reduce ? `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : "none";
      t.style.transform = x ? `translate3d(${x}px,0,0)` : "";
    };

    const onStart = (e: TouchEvent) => {
      if (settling || e.touches.length !== 1) return;
      const p = e.touches[0]!;
      if (p.clientX < EDGE_PX || scrollsSideways(e.target as Element, el)) return;
      start = { x: p.clientX, y: p.clientY, t: e.timeStamp };
      axis = null;
      dx = 0;
      target = null;
      latest.current.onIntent();
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const p = e.touches[0]!;
      const mx = p.clientX - start.x;
      const my = p.clientY - start.y;
      if (!axis) {
        if (Math.abs(mx) < LOCK_PX && Math.abs(my) < LOCK_PX) return;
        axis = Math.abs(mx) > Math.abs(my) ? "h" : "v";
        if (axis === "v") {
          start = null;
          return;
        }
      }
      e.preventDefault();
      const key = mx < 0 ? latest.current.next : latest.current.prev;
      if (key !== target) {
        target = key;
        setPeek(key ? { key, side: mx < 0 ? "right" : "left" } : null);
      }
      // no section that way: the edge gives a little and holds
      dx = key ? mx : mx / 4;
      move(dx, false);
    };

    const onEnd = (e: TouchEvent) => {
      if (!start || axis !== "h") {
        start = null;
        return;
      }
      const width = el.clientWidth || 1;
      const speed = Math.abs(dx) / Math.max(1, e.timeStamp - start.t);
      start = null;
      const key = target;
      if (key && (Math.abs(dx) > width * COMMIT_RATIO || speed > FLICK_PX_PER_MS)) {
        settling = true;
        const done = () => {
          settling = false;
          latest.current.onCommit(key);
        };
        if (reduce) return done();
        move(dx < 0 ? -width : width, true);
        window.setTimeout(done, SETTLE_MS);
        return;
      }
      move(0, true);
      window.setTimeout(() => setPeek(null), SETTLE_MS);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    // not passive: a sideways drag must stop the browser treating it as anything else
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [region, track]);

  // The section changed (a swipe landed, or a tab was tapped): put the track back in place in the SAME paint
  // the new section becomes the visible one, so nothing jumps.
  useLayoutEffect(() => {
    const t = track.current;
    if (t) {
      t.style.transition = "none";
      t.style.transform = "";
    }
    setPeek(null);
  }, [active, track]);

  return peek;
}

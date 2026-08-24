"use client";

import { useCallback, useRef } from "react";

/**
 * Pure decision, exported and unit-tested on its own
 * (`use-tap-or-double-tap.test.ts`) — the one piece of this gesture
 * disambiguation meaningful to test without a real DOM/timer environment,
 * which this project deliberately doesn't set up for component tests (see
 * vitest.config.ts's own comment). `lastTapAt <= 0` is the "no tap is
 * currently pending" sentinel — used both before the very first tap ever,
 * and immediately after a double-tap has already been consumed, so a THIRD
 * tap arriving quickly after never doubles up against the already-spent
 * second one.
 */
export function isDoubleTap(now: number, lastTapAt: number, doubleTapMs: number): boolean {
  return lastTapAt > 0 && now - lastTapAt < doubleTapMs;
}

/**
 * Whether a pointerup should be treated as a real tap on this element.
 *
 * Pure and exported for the same reason `isDoubleTap` is: this is the decision
 * that regressed. Extracting the hold-then-open pattern out of `FeedVideo`
 * dropped its `started` check, which is what let a tap on an OVERLAID control
 * (the blended Wow/Comment/Save row inside FeedImage) open the reel viewer —
 * that row stops pointerdown but not pointerup, so the hook saw a pointerup it
 * never had a pointerdown for and treated it as a tap on the photo.
 *
 *   `started` — a pointerdown for this gesture actually landed on the element.
 *   `moved`   — the pointer travelled past the tolerance: a drag or a scroll.
 */
export function isRealTap(started: boolean, moved: boolean): boolean {
  return started && !moved;
}

/**
 * Disambiguates a single tap from a double tap on the SAME element, so a
 * single tap can safely trigger a delayed action (opening a full-screen
 * viewer) while a double tap CANCELS it and fires a different action instead
 * (Wow) — the expand action never fires first and gets "caught up to" by a
 * fast second tap.
 *
 * Extracted from the pattern `features/media/feed-video.tsx` already proved
 * out (owner spec, 2026-08-17 — "Double tap → Reels opens" must NEVER
 * happen, the delay is intentional and configurable, ~250-350ms). `FeedVideo`
 * itself keeps its own inline version rather than switching to this hook —
 * it layers a THIRD gesture (press-and-hold-to-pause) over the same pointer
 * events, and that interaction is proven/battle-tested; this hook is for the
 * simpler two-gesture (tap / double-tap) surfaces — `FeedImage` and
 * `MediaCarousel` — which previously opened their viewer instantly on the
 * FIRST tap of a double-tap (a deliberate 2026-07-15 "zero wait" trade-off)
 * instead of waiting to see if a second tap was coming.
 */
export function useTapOrDoubleTap({
  onTap,
  onDoubleTap,
  expandDelayMs = 350,
  doubleTapMs = 350,
  moveTolerance = 12,
}: {
  /** Fires after `expandDelayMs` if no second tap arrived — open the viewer. */
  onTap: () => void;
  /** Fires instead of `onTap` when a second tap lands within `doubleTapMs`. */
  onDoubleTap: () => void;
  /**
   * How long a single tap is held back, in case a second tap follows.
   *
   * 🔴 MUST be >= `doubleTapMs`, never shorter (owner, 2026-08-18: "video
   * double tap sometimes open the video" — traced to `FeedVideo`'s own
   * inline copy of this exact pattern using 280ms here against a 300ms
   * `doubleTapMs`, so a genuine but slightly slow second tap landing in that
   * 20ms gap arrived AFTER the single-tap action had already fired. This
   * hook inherited the same two numbers when it was extracted from that
   * code, so it had the identical bug in `FeedImage`/`MediaCarousel` even
   * though only the video case was reported. Defaults equal to
   * `doubleTapMs`, closing the race by construction — override only if you
   * also raise `doubleTapMs` to match.
   *
   * 🔴 300 → 350 (owner, 2026-08-18, again: "single post in feed opens on
   * double tap" — the race above was already closed by construction, so a
   * real double-tap's own gap must simply be exceeding a 300ms window on a
   * genuine touch device now and then. 350ms is still inside the spec's own
   * stated "approximately 250-350ms" range (see this hook's test file) —
   * the upper end of what was always considered acceptable, not a new
   * number invented for this fix.
   */
  expandDelayMs?: number;
  /** Window a second tap has to land in to count as a double-tap. */
  doubleTapMs?: number;
  moveTolerance?: number;
}) {
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const lastTapAt = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTapTimer = useCallback(() => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = null;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startPt.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPt.current || moved.current) return;
      if (Math.abs(e.clientX - startPt.current.x) > moveTolerance || Math.abs(e.clientY - startPt.current.y) > moveTolerance) {
        moved.current = true;
      }
    },
    [moveTolerance],
  );

  const onPointerUp = useCallback(() => {
    /*
      🔴 A POINTERUP WITH NO MATCHING POINTERDOWN IS NOT A TAP (owner,
      2026-08-23: "liking a single post from a post that has the engagement on
      the card still opens the post in reels").

      The blended engagement row renders INSIDE FeedImage's container (as
      `children`), so its buttons sit under the same pointer handlers as the
      photo. That row already calls `stopPropagation()` on pointerDOWN — but
      only pointerdown. The matching pointerUP still bubbled up to here, and
      this handler had no way to tell it apart from a genuine tap on the
      photo: `startPt` was null and `moved` held whatever the PREVIOUS
      interaction left behind, so a tap on Wow/Comment/Save scheduled `onTap`
      and the reel viewer opened ~350ms later, on top of the like.

      `started` is the guard, and it is the same one `FeedVideo`'s own inline
      gesture machine has always had (`const started = startPt.current !==
      null` in its `endHold`) — this hook simply lost it when the pattern was
      extracted, which is why only the image/carousel surfaces showed the bug.
      Fixing it here rather than adding a second `stopPropagation` to the row
      covers every child that will ever be placed over these surfaces, instead
      of requiring each one to remember.
    */
    const started = startPt.current !== null;
    const wasMoved = moved.current;
    startPt.current = null;
    if (!isRealTap(started, wasMoved)) return;

    const now = Date.now();
    if (isDoubleTap(now, lastTapAt.current, doubleTapMs)) {
      // Second tap arrived in time — cancel whatever single-tap is pending
      // and fire the double-tap action instead. The expand action NEVER
      // fires in this branch, no matter how close the timer was to firing.
      lastTapAt.current = 0;
      clearTapTimer();
      onDoubleTap();
      return;
    }
    // Hold the tap action for the grace window in case a second tap follows.
    lastTapAt.current = now;
    clearTapTimer();
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      onTap();
    }, expandDelayMs);
  }, [clearTapTimer, doubleTapMs, expandDelayMs, onDoubleTap, onTap]);

  const onPointerLeave = useCallback(() => {
    startPt.current = null;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerLeave, onPointerCancel: onPointerLeave };
}

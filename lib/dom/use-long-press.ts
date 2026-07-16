"use client";

import { useCallback, useEffect, useRef } from "react";

import { haptic } from "@/lib/motion/haptics";

/** iOS's own press-and-hold feels like ~0.5s; 450ms lands just under it so the
 *  menu beats the system callout rather than racing it. */
const HOLD_MS = 450;
/** Past this much finger travel it's a scroll, not a hold. iOS's own scroll
 *  slop is ~10px; 12 leaves room for a shaky thumb without swallowing drags. */
const MOVE_TOLERANCE_PX = 12;

/**
 * Press-and-hold → fire, with the anchor element handed back so a caller can
 * position a menu against the thing that was actually held.
 *
 * Owner (2026-07-16): "make the dotted menu in the chat page be replaced with
 * press and hold" — long-pressing a message bubble now opens its actions, and
 * the permanent "⋯" glyph that used to sit beside every bubble is gone (that
 * glyph existing at all is most of why the thread never looked premium).
 *
 * Cancels on movement so it can never hijack a scroll — the single most
 * important property here, since these live inside a vertically scrolling
 * thread. Also suppresses the click and the native context menu that would
 * otherwise follow the hold, so a hold does exactly one thing.
 */
export function useLongPress(onLongPress: (anchor: HTMLElement) => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  // A hold that fires while the component unmounts (navigating away mid-press)
  // would otherwise leave a dangling timer.
  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Ignore secondary buttons — right-click is handled by onContextMenu.
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const anchor = e.currentTarget;
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        haptic("selection");
        onLongPress(anchor);
      }, HOLD_MS);
    },
    [onLongPress],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const o = origin.current;
      if (!o) return;
      if (Math.abs(e.clientX - o.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - o.y) > MOVE_TOLERANCE_PX) clear();
    },
    [clear],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      // Desktop's natural equivalent of a hold. Without this, removing the "⋯"
      // would leave mouse users with no discoverable way in at all — and it
      // also suppresses the OS menu that a touch-hold would otherwise raise on
      // top of ours.
      e.preventDefault();
      if (fired.current) return;
      fired.current = true;
      onLongPress(e.currentTarget);
    },
    [onLongPress],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu,
    /** Swallow the click that follows a completed hold (a tap still passes). */
    onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
      if (!fired.current) return;
      e.preventDefault();
      e.stopPropagation();
      fired.current = false;
    },
  };
}

"use client";

import { useCallback, useRef } from "react";

import { haptic } from "@/lib/motion/haptics";

/**
 * Long-press detection for buttons that have both a tap and a hold action
 * (e.g. Repost: tap = composer, hold = advanced options). Pointer-based so it
 * works for touch + mouse; a hold is cancelled by movement (>10px — it's a
 * scroll) or release before the threshold. When the hold fires, the following
 * click is suppressed so the tap action never double-triggers, and we nudge
 * haptics where supported.
 */
export function useLongPress(onLongPress: () => void, { ms = 450 }: { ms?: number } = {}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        haptic("selection");
        onLongPress();
      }, ms);
    },
    [onLongPress, ms],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (dx * dx + dy * dy > 100) clear(); // moved — it's a scroll, not a hold
    },
    [clear],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (fired.current) {
      e.preventDefault();
      e.stopPropagation();
      fired.current = false;
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClickCapture,
    // Mobile browsers open their own context menu on long-press otherwise.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

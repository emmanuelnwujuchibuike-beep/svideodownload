"use client";

import { useCallback, useRef, useState } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PINCH TO ZOOM (Feature 15, Part 2 — tranche 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 The hard part is not the maths, it is the four gestures already here ─
 *
 * The reel media stage is the busiest gesture surface in the app. Before this it
 * already owned:
 *
 *   • a vertical snap-scroll (reel to reel), owned by the browser;
 *   • a horizontal finger-tracked drag (album slides);
 *   • a double-tap seek, left and right;
 *   • a press-and-hold (pause + open the options sheet).
 *
 * A naive pinch handler breaks all four, because a two-finger gesture starts as
 * two ordinary pointerdowns and every one of those handlers claims the first.
 *
 * The rule that keeps them apart is SECOND POINTER WINS, IMMEDIATELY:
 *
 *   1 pointer  → nothing here runs. Scroll, drag, tap and hold behave exactly as
 *                they did; this hook is not in the path at all.
 *   2 pointers → a pinch has unambiguously begun. `onSecondPointer` fires so the
 *                card can cancel its hold timer and abandon any album drag in
 *                flight, and from then until the last finger lifts every other
 *                gesture is suppressed by the card.
 *
 * There is no threshold and no "is it a pinch yet" heuristic, because a
 * heuristic means a window in which two handlers both think they own the
 * gesture — and that window is exactly where a drag fights a zoom and the video
 * jitters.
 *
 * ── Why the transform is written to a ref, not to state ────────────────────
 *
 * A pinch produces a pointermove per finger per frame. Routing that through
 * React would re-render the card — the rail, the caption, the scrubber — up to
 * 120 times a second on the one surface that is also decoding video. The
 * transform is written straight to the element's style; React only learns about
 * the START and the END, which is twice per gesture.
 *
 * ── Why it always springs back ─────────────────────────────────────────────
 *
 * Zoom is momentary here, not a mode: a reel left at 3× would still be zoomed
 * when the next one scrolls in, and there is no visible control to undo it. This
 * is the same reasoning as hold-to-speed not being persisted.
 */

const MAX_SCALE = 4;
const MIN_SCALE = 1;

export interface PinchZoom {
  /** True while a pinch is on screen — for rendering only (a hint, a cursor). */
  active: boolean;
  /**
   * 🔴 The SYNCHRONOUS answer, read from a ref.
   *
   * `active` is React state and does not update within the handler that set it,
   * so gating the card's own gestures on it would let the second finger's
   * pointerdown run the tap/hold path anyway. Every gate below uses this.
   */
  isPinching: () => boolean;
  /** Returns true when this pointer belongs to a pinch — caller should stand down. */
  onPointerDown: (e: React.PointerEvent) => boolean;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function usePinchZoom(
  target: { current: HTMLElement | null },
  /** Called the instant a second finger lands, so the caller can stand down. */
  onSecondPointer?: () => void,
): PinchZoom {
  const points = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const [active, setActive] = useState(false);
  /*
    A pinch is "in progress" from the moment the second finger lands until the
    LAST one lifts — deliberately not "two fingers are currently down". Lifting
    one finger of a pinch leaves the other down, and re-enabling the
    single-finger gestures at that instant turns the tail of a zoom into an
    accidental album swipe or a tap-to-pause. Kept in a ref because the answer is
    needed synchronously inside the handler that changes it.
  */
  const pinching = useRef(false);

  const paint = useCallback(
    (scale: number, dx: number, dy: number) => {
      const el = target.current;
      if (!el) return;
      el.style.transform = scale === 1 && dx === 0 && dy === 0 ? "" : `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
    },
    [target],
  );

  const reset = useCallback(() => {
    const el = target.current;
    if (!el) return;
    // Transition only on the way BACK. During the pinch the transform must track
    // the fingers exactly — an eased transform lags behind the pinch and reads as
    // the video being sluggish rather than as smoothing.
    el.style.transition = "transform 260ms cubic-bezier(.22,1,.36,1)";
    el.style.transform = "";
    window.setTimeout(() => {
      if (target.current) target.current.style.transition = "";
    }, 280);
  }, [target]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent): boolean => {
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.current.size === 2) {
        const [a, b] = [...points.current.values()];
        start.current = {
          dist: distance(a!, b!),
          cx: (a!.x + b!.x) / 2,
          cy: (a!.y + b!.y) / 2,
        };
        if (target.current) target.current.style.transition = "";
        pinching.current = true;
        setActive(true);
        // Tell the card NOW, before any move event, so a hold timer or an album
        // drag started by the first finger is cancelled rather than racing this.
        onSecondPointer?.();
      }
      return points.current.size >= 2;
    },
    [onSecondPointer, target],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!points.current.has(e.pointerId)) return;
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const s = start.current;
      if (!s || points.current.size < 2) return;
      const [a, b] = [...points.current.values()];
      const dist = distance(a!, b!);
      if (s.dist <= 0) return;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, dist / s.dist));
      // Follow the midpoint so the picture tracks the fingers instead of always
      // growing from the centre of the screen.
      const cx = (a!.x + b!.x) / 2;
      const cy = (a!.y + b!.y) / 2;
      paint(scale, cx - s.cx, cy - s.cy);
    },
    [paint],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      points.current.delete(e.pointerId);
      if (points.current.size < 2 && start.current) {
        start.current = null;
        reset();
        // 🔴 `active` is cleared only when EVERY finger is up, not when the count
        // drops below two. Lifting one finger of a pinch leaves the other one
        // down, and re-enabling the single-finger gestures at that moment turns
        // the tail of a zoom into an accidental album swipe.
        if (points.current.size === 0) {
          pinching.current = false;
          setActive(false);
        }
      } else if (points.current.size === 0) {
        pinching.current = false;
        setActive(false);
      }
    },
    [reset],
  );

  const isPinching = useCallback(() => pinching.current, []);

  return { active, isPinching, onPointerDown, onPointerMove, onPointerUp };
}

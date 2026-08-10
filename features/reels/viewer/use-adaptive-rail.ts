"use client";

import { useEffect, useState } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADAPTIVE ACTION RAIL™ (Feature 15, Part 1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Instead of permanently fixing buttons to the edge, the action rail
 *  intelligently shifts slightly inward based on phone size, foldable layout,
 *  landscape mode and tablet width — so every control is easier to reach with
 *  one hand while preserving a familiar layout."
 *
 * ── Why the edge is the wrong place, concretely ────────────────────────────
 *
 * Every major short-video app pins its action rail flush to the right edge.
 * That was fine when phones were 4.7". On a 6.7" device held one-handed, the
 * comfortable thumb arc is roughly a 130-150mm sweep anchored at the bottom
 * corner — and the TOP of a flush-right rail (the avatar and follow button) sits
 * outside it. The observable result is the two-handed regrip everyone does
 * without noticing.
 *
 * Pulling the rail inward by a modest amount moves those controls back inside
 * the arc while keeping the rail unmistakably a right-hand rail. This is not a
 * new interaction to learn — it is the same rail, positioned for the device it
 * is actually on.
 *
 * ── Why the inset GROWS with the screen ────────────────────────────────────
 *
 * Counter-intuitive at first: a bigger screen gets a bigger inset. But reach is
 * anchored at the bottom-right corner and does not scale with the display, so
 * the wider the device the further the edge is from the thumb. A 320px phone
 * needs almost no correction; a tablet needs a lot, because on a tablet the
 * edge is not reachable at all and the rail should sit where a hand actually is.
 *
 * ── Landscape is a different problem, not a bigger one ─────────────────────
 *
 * In landscape the video is wide and the vertical space is scarce, so the rail
 * competes with the video rather than with the thumb. There the inset stays
 * small and the rail TIGHTENS vertically instead (`compact`), because the
 * failing constraint has changed from reach to height.
 *
 * ── What this deliberately does NOT do ─────────────────────────────────────
 *
 * It does not detect handedness. The spec lists it as optional and it is the one
 * item here that cannot be inferred without either asking or guessing from
 * touch positions — and a rail that silently migrates to the other side because
 * someone passed their phone to a friend is worse than no adaptation at all. If
 * it ships it should be an explicit setting, which belongs with the other
 * viewer preferences rather than in a layout hook.
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 *
 * One resize listener, rAF-coalesced, shared by the whole deck through the
 * single hook instance in `ReelDeck` — NOT per card. A per-card listener would
 * mean N listeners for N reels and N state updates per resize, which is exactly
 * the pattern that made the download manager notify per-patch before it was
 * coalesced (recorded 2026-08-10).
 */

export interface RailLayout {
  /** Distance from the right edge, in px. Feed to `right` on the rail. */
  inset: number;
  /** Vertical gap between rail buttons, in px. Tightens in landscape. */
  gap: number;
  /** True when vertical space is the binding constraint (landscape/short). */
  compact: boolean;
  /** Coarse class, exposed for anything that needs to branch harder. */
  form: "phone" | "large-phone" | "foldable" | "tablet" | "desktop";
}

/**
 * Breakpoints are on the SHORTER viewport edge, not on width.
 *
 * Width alone cannot tell a landscape phone from a small tablet — both report
 * ~800px — and they want opposite treatments. The short edge separates them
 * cleanly: a landscape phone is short, a tablet is not.
 */
function resolve(w: number, h: number): RailLayout {
  const short = Math.min(w, h);
  const landscape = w > h;

  // Landscape: height is scarce. Keep the rail close to the edge and tighten it
  // vertically so it does not eat the video.
  if (landscape && short < 600) {
    return { inset: 10, gap: 14, compact: true, form: "large-phone" };
  }

  if (short < 360) {
    // Small phone. The edge is already within reach and there is no width to
    // spare — almost no correction, or the rail starts covering the video.
    return { inset: 8, gap: 20, compact: false, form: "phone" };
  }
  if (short < 412) {
    return { inset: 12, gap: 22, compact: false, form: "phone" };
  }
  if (short < 500) {
    // Large phone — the case this system exists for. The top of a flush rail is
    // out of the thumb arc here.
    return { inset: 18, gap: 24, compact: false, form: "large-phone" };
  }
  if (short < 700) {
    // Unfolded foldable. Wide, and usually held with both hands, but the rail
    // still wants to be nearer the middle than the bezel.
    return { inset: 26, gap: 26, compact: false, form: "foldable" };
  }
  if (short < 1024) {
    // Tablet. The edge is genuinely unreachable one-handed.
    return { inset: 34, gap: 28, compact: false, form: "tablet" };
  }
  // Desktop — a pointer, so reach is irrelevant and the inset is purely
  // compositional: the rail sits off the video's shoulder rather than on it.
  return { inset: 28, gap: 26, compact: false, form: "desktop" };
}

export function useAdaptiveRail(): RailLayout {
  // SSR-safe seed. Matches the `short < 412` phone case, which is the most
  // common real device — so the first client paint is already right for most
  // visitors and there is nothing to correct.
  const [layout, setLayout] = useState<RailLayout>({
    inset: 12,
    gap: 22,
    compact: false,
    form: "phone",
  });

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = resolve(window.innerWidth, window.innerHeight);
      // Only re-render when something actually changed. A resize storm
      // (rotation, keyboard, foldable hinge) fires continuously, and this hook
      // sits above the whole deck — a state update per event would re-render
      // every mounted card for values that are usually identical.
      setLayout((prev) =>
        prev.inset === next.inset &&
        prev.gap === next.gap &&
        prev.compact === next.compact &&
        prev.form === next.form
          ? prev
          : next,
      );
    };

    const onResize = () => {
      // rAF-coalesced: resize can fire dozens of times per second during a
      // rotation or a foldable unfold, and we only need the settled value.
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("resize", onResize, { passive: true });
    // `orientationchange` fires BEFORE the new dimensions are readable on some
    // engines, so it is handled through resize as well rather than instead.
    window.addEventListener("orientationchange", onResize, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return layout;
}

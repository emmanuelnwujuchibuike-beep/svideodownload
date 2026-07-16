"use client";

import { useEffect, useState } from "react";

export interface VisualViewportState {
  height: number | null;
  /** Heuristic — there's no direct "keyboard is open" API, so this treats a
   * visual viewport materially smaller than the layout viewport as one. */
  keyboardOpen: boolean;
}

/**
 * Tracks `window.visualViewport` (iOS Safari 13+, all Chromium) so a
 * component can react to the on-screen keyboard opening/closing — e.g.
 * re-snapping a scrolled-to-bottom message list once the keyboard shrinks
 * its container height. Most layout-level keyboard issues (fixed bottom nav
 * hidden behind the keyboard) are handled at the CSS level by
 * `interactiveWidget: "resizes-content"` in app/layout.tsx instead — reach
 * for this hook only when a component needs to actually KNOW the keyboard
 * state in JS, not just reflow around it.
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>({ height: null, keyboardOpen: false });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setState({
        height: vv.height,
        keyboardOpen: window.innerHeight - vv.height > 120,
      });
    };
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  return state;
}

/** Inline style that pins a `position: fixed; inset: 0` element to the VISUAL
 *  viewport. `null` means "don't override anything — plain CSS is correct". */
export interface ViewportPin {
  top: string;
  height: string;
  bottom: string;
}

/**
 * Glues a full-screen `fixed inset-0` surface to the part of the screen the
 * user can actually SEE — the visual viewport — instead of the layout viewport.
 *
 * Why (owner, 2026-07-16, reported twice: the chat's name/last-seen/call header
 * must stay fixed "even when the placeholder and keyboard is opened"):
 * `interactiveWidget: "resizes-content"` in app/layout.tsx handles this on
 * Chromium by shrinking the LAYOUT viewport, so `inset-0` reflows and the
 * header stays put. **Safari ignores `interactiveWidget`** — iOS keeps the
 * layout viewport at full height, shrinks the VISUAL viewport, and scrolls it
 * to reveal the focused input. A `position: fixed` element is anchored to the
 * unchanged layout viewport, so it rides up out of view. That's the reported
 * symptom, and it's documented platform behaviour, not a mistake in the
 * thread's own layout (its header is `shrink-0` above a `flex-1 overflow-y-auto`
 * list, which is correct).
 *
 * This tracks the visual viewport CONTINUOUSLY while mounted rather than
 * switching on a "keyboard looks open" heuristic. The first version gated on
 * `innerHeight - vv.height > 120`, which left two real holes: nothing was
 * pinned during the keyboard's open/close animation (so the header visibly
 * jumped), and a SHORT keyboard — an iPad hardware-keyboard accessory bar, a
 * floating/split keyboard — never crossed 120px at all, so the header was
 * pushed off-screen with no correction. Tracking continuously removes the
 * heuristic entirely.
 *
 * It is a no-op in the common case: with no keyboard, `vv.height` equals the
 * layout height and `vv.offsetTop` is 0, so this resolves to exactly what
 * `inset-0` already does. `bottom` must be released to `auto` — `inset-0`'s
 * `bottom: 0` would otherwise fight the explicit height and stretch the box
 * back down under the keyboard.
 *
 * Returns `null` (no override) on large screens, where the thread is a normal
 * in-flow pane in the desktop split layout rather than a fixed overlay, and
 * where the CSS must stay authoritative.
 *
 * NOTE: this cannot be reproduced in a desktop browser — Chromium's headless
 * viewport never emulates the iOS keyboard's visual-viewport behaviour. It's
 * written against the documented platform contract and needs a real device to
 * confirm.
 */
export function useVisualViewportPin(): ViewportPin | null {
  const [pin, setPin] = useState<ViewportPin | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // Matches the `lg:` breakpoint the thread page uses to drop out of its
    // fixed-overlay mode.
    const desktop = window.matchMedia("(min-width: 1024px)");

    const update = () => {
      if (desktop.matches) {
        setPin(null);
        return;
      }
      const next: ViewportPin = {
        top: `${Math.round(vv.offsetTop)}px`,
        height: `${Math.round(vv.height)}px`,
        bottom: "auto",
      };
      // Only re-render when a value actually changed — `scroll` on the visual
      // viewport fires continuously during a keyboard animation and momentum
      // scrolling, and this sits above the whole thread.
      setPin((prev) =>
        prev && prev.top === next.top && prev.height === next.height ? prev : next,
      );
    };

    update();
    vv.addEventListener("resize", update);
    // iOS scrolls the visual viewport while the keyboard animates in and when
    // focus moves between fields — without tracking scroll too, the surface
    // would re-anchor once and then drift back off.
    vv.addEventListener("scroll", update);
    desktop.addEventListener("change", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      desktop.removeEventListener("change", update);
    };
  }, []);

  return pin;
}

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
 * Keeps a full-screen `fixed inset-0` surface glued to the part of the screen
 * the user can actually SEE while the on-screen keyboard is open.
 *
 * Why this is needed (owner, 2026-07-16: the chat's name/last-seen/call header
 * must stay fixed "even when the placeholder and keyboard is opened"):
 * `interactiveWidget: "resizes-content"` in app/layout.tsx already handles this
 * on Android/Chromium by shrinking the LAYOUT viewport, so `inset-0` reflows
 * and the header stays put. iOS Safari/WKWebView does not do that — it leaves
 * the layout viewport at full height and instead shrinks the VISUAL viewport
 * and scrolls it. A `position: fixed` element stays pinned to the (unchanged)
 * layout viewport, so the thread's header is pushed up out of the visible area
 * the moment the composer takes focus. That's the exact reported symptom, and
 * it's a documented iOS behaviour, not a layout mistake in the thread itself.
 *
 * So: while the keyboard is up, re-anchor the surface to
 * `visualViewport.offsetTop` with `visualViewport.height`. `bottom` must be
 * released to `auto` — `inset-0`'s `bottom: 0` would otherwise fight the
 * explicit height and stretch the box back under the keyboard.
 *
 * Returns `null` (no override) on large screens, where the thread is a normal
 * in-flow pane inside the desktop split layout rather than a fixed overlay,
 * and whenever the keyboard is closed, so the plain CSS stays authoritative in
 * the common case.
 */
export function useKeyboardViewportPin(): ViewportPin | null {
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
      const keyboardOpen = window.innerHeight - vv.height > 120;
      setPin(
        keyboardOpen
          ? { top: `${vv.offsetTop}px`, height: `${vv.height}px`, bottom: "auto" }
          : null,
      );
    };

    update();
    vv.addEventListener("resize", update);
    // iOS scrolls the visual viewport while the keyboard animates in and when
    // focus moves between fields — without tracking scroll too, the surface
    // would re-anchor once and then drift.
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

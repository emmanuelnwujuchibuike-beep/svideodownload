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

"use client";

import { type ComponentType, useEffect, useState } from "react";

import type { ExclusiveCreateFabProps } from "@/features/sub/exclusive-create-fab";

/**
 * Where the Exclusive feed's floating "+" mounts (owner, 2026-10-31: "the floating button should lazy load on landing
 * and warm up and prefetch after landing, without breaking the performance").
 *
 * This slot is the only part of it in the page's first JS, and it renders nothing. The button itself
 * (exclusive-create-fab.tsx) is imported once the page has LOADED and the browser is idle, so it never competes with
 * the feed's first cards; it is `fixed`, so appearing late moves nothing (no layout shift).
 */
export function ExclusiveFabSlot(props: ExclusiveCreateFabProps) {
  const [Fab, setFab] = useState<ComponentType<ExclusiveCreateFabProps> | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () =>
      void import("@/features/sub/exclusive-create-fab").then(
        (m) => {
          if (!dead) setFab(() => m.ExclusiveCreateFab);
        },
        () => undefined,
      );
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const start = () => (idle ? idle(load, { timeout: 3000 }) : window.setTimeout(load, 1200));
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      dead = true;
      window.removeEventListener("load", start);
    };
  }, []);
  return Fab ? <Fab {...props} /> : null;
}

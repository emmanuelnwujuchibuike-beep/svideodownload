"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const PromoteBubble = dynamic(() => import("@/features/downloads/promote-bubble").then((m) => m.PromoteBubble), { ssr: false });

/** The promote bubble, loaded only once the page is idle (owner, 2026-10-09: "it should also lazy load"). Renders nothing until then. */
export function PromoteBubbleLazy() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setReady(true), 1500);
    return () => window.clearTimeout(t);
  }, []);
  return ready ? <PromoteBubble /> : null;
}

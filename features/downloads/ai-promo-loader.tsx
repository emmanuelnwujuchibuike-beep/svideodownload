"use client";

import { useEffect, useState, type ComponentType } from "react";

import type { AiPromo } from "@/lib/ai/promo/config";

/**
 * The only JavaScript the landing promotion puts on the page before it is needed
 * (Brief C §8–§9): this loader, a few hundred bytes. It waits for the page's own
 * `load`, then the admin's delay (default 2 s), then idle time — and only then
 * fetches the driver chunk that plays the video and the before/after pair. A
 * visitor who leaves sooner downloads none of it, and the hero, the paste field
 * and the CTA never compete with it.
 */
export function AiPromoLoader({ promo }: { promo: AiPromo }) {
  const [Driver, setDriver] = useState<ComponentType<{ promo: AiPromo }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Right after load (and idle) — the driver itself waits the delay, warming the clip meanwhile (owner: "it delays").
    const start = () => {
      timer = setTimeout(() => {
        const go = () =>
          void import("@/features/downloads/ai-promo-driver").then((m) => {
            if (!cancelled) setDriver(() => m.AiPromoDriver);
          });
        const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
        if (ric) ric(go, { timeout: 1000 });
        else go();
      }, 0);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return Driver ? <Driver promo={promo} /> : null;
}

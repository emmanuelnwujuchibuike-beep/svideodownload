"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const PromoteBubble = dynamic(() => import("@/features/downloads/promote-bubble").then((m) => m.PromoteBubble), { ssr: false });

/*
 * Owner 2026-10-09: "make the promote button cache so it doesn't reload on every entry and
 * back swipe". The FIRST appearance still waits for an idle moment (never in first paint);
 * after that the bubble is remembered - for the rest of this page's life (module flag) and
 * across reloads in this tab (sessionStorage) - so it is there at once on every return.
 */
const SEEN_KEY = "frenz.promote.seen";
let seenThisPage = false;

function seenBefore(): boolean {
  if (seenThisPage) return true;
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** The promote bubble, loaded once the page is idle the first time, then at once on every return. */
export function PromoteBubbleLazy() {
  const [ready, setReady] = useState(() => typeof window !== "undefined" && seenThisPage);
  useEffect(() => {
    if (ready) return;
    if (seenBefore()) {
      setReady(true);
      return;
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setReady(true), 1500);
    return () => window.clearTimeout(t);
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    seenThisPage = true;
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode: the module flag still covers this page */
    }
  }, [ready]);
  return ready ? <PromoteBubble /> : null;
}

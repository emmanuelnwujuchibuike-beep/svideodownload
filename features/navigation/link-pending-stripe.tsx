"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE STRIPE A TAPPED LINK SHOWS WHILE THE NEXT PAGE IS ON ITS WAY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-14: "the AI pages' Start Creating button doesn't respond
 * instant, and open instant or show a stripe loader when it hasn't prefetched
 * or cached."
 *
 * Rendered INSIDE a `<Link>`. `useLinkStatus` is Next's own per-link pending
 * flag: true from the tap until the new route commits. When the route was
 * prefetched the commit is immediate and this never shows; when it was not —
 * a cold tab, a route the browser has not seen, a slow LTE — a thin bar
 * sweeps along the top of the viewport after 120 ms so the tap is visibly
 * doing something, and the button itself reads `aria-busy`.
 *
 * 🔴 LOCAL BY DESIGN. It reads the status of the one link it sits in; it
 * does not listen to the router, wrap navigation, or touch prefetching —
 * the standing rule against global navigation runtime holds. Portaled to
 * <body> because a `position: fixed` element inside a card with a
 * transform or backdrop-filter is positioned by that card, not the viewport.
 */
export function LinkPendingStripe({ delayMs = 120 }: { delayMs?: number }) {
  const { pending } = useLinkStatus();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!pending) {
      setShown(false);
      return;
    }
    const t = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(t);
  }, [pending, delayMs]);

  if (!shown || typeof document === "undefined") return null;
  return createPortal(
    <div role="progressbar" aria-label="Opening" aria-busy="true" className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[3px] overflow-hidden bg-primary/15">
      <span aria-hidden className="frenz-loader-bar absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-fuchsia-500" />
    </div>,
    document.body,
  );
}

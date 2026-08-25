"use client";

import { type RefObject, useEffect, useRef } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TAKE THE USER TO THE RESULT WHEN A FETCH RESOLVES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-25: *"fetch in single link should direct users to the fetch
 * card below the multi link section so users know the fetch completed and so
 * they dont have to scroll down to see."*
 *
 * The paste box and the result card are no longer neighbours. Since the
 * reference restructure the card stack reads: paste box → Install banner →
 * ＋Multiple Links → supported platforms → detected-platform line → RESULT. So
 * a fetch can succeed entirely off-screen: the button stops spinning somewhere
 * above the fold and nothing else appears to happen. That is indistinguishable
 * from a fetch that failed silently, which is the worst thing a downloader can
 * look like.
 *
 * ── Why a hook and not another `useEffect` in the component ────────────────
 *
 * There are TWO paste boxes in this app — `features/downloads/download-box.tsx`
 * (landing hero + /downloads) and `features/downloader/downloader.tsx` (the ~148
 * generated platform pages). The second already had a private copy of this
 * effect, phone-only, and the first had none, which is exactly why the owner
 * saw the bug on the surface they actually use. Two copies of one behaviour is
 * how "I changed it and it still does the same thing" happens here — the same
 * reasoning already recorded on the supported-platforms strip.
 *
 * ── The three judgement calls ──────────────────────────────────────────────
 *
 *  1. EVERY VIEWPORT, not just phones. The old copy was gated to `innerWidth <
 *     768`. The blocks listed above sit between the field and the result on a
 *     desktop too — the gate was written when they didn't.
 *
 *  2. SKIP WHEN IT IS ALREADY IN VIEW. Scrolling someone who can already see
 *     the card is a yank, not a help. Only moves when the result's top edge is
 *     off-screen or sitting low in the viewport.
 *
 *  3. WAIT A BEAT FIRST. `PreviewCard` is a `dynamic(..., { ssr: false })`
 *     import, so at the instant `metadata` lands the wrapper can still be an
 *     empty box. Anchoring to the wrapper's TOP (`block: "start"`) makes the
 *     final height irrelevant, and one frame plus a short delay lets the chunk
 *     paint so the scroll ends on something rather than on nothing.
 */
export function useScrollToResult(
  ref: RefObject<HTMLElement | null>,
  /**
   * Identity of the current result — `metadata?.id`. Changing it is what
   * triggers the scroll, so re-renders during the same result never re-scroll
   * and a SECOND fetch of the SAME video still does.
   */
  resultKey: string | null | undefined,
) {
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!resultKey) {
      // A reset / new fetch clears the key, which re-arms the next result.
      lastKey.current = null;
      return;
    }
    if (lastKey.current === resultKey) return;
    lastKey.current = resultKey;

    let raf = 0;
    const timer = window.setTimeout(() => {
      raf = window.requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;

        const { top } = el.getBoundingClientRect();
        // Already comfortably on screen — leave the page where it is.
        if (top >= 0 && top <= window.innerHeight * 0.6) return;

        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      });
    }, 90);

    return () => {
      window.clearTimeout(timer);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [ref, resultKey]);
}

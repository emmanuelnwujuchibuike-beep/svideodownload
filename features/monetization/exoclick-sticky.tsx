"use client";

import { useEffect, useRef, useState } from "react";

import {
  EXOCLICK_PROVIDER_SRC,
  type ExoClickStickyTag,
} from "@/lib/monetization/exoclick-sticky";

import { useShowAds } from "./use-show-ads";

/**
 * The ExoClick sticky banner — their DISPLAY product, which places itself.
 *
 * Unlike every other ExoClick placement in this codebase, nothing here decides
 * where the unit appears: `ad-provider.js` pins it to the viewport itself. We
 * only supply the `<ins>` placeholder it looks for, which is why this component
 * renders a zero-size host and no chrome at all.
 *
 * ── Lazy by construction ──────────────────────────────────────────────────────
 *
 * The loader is only appended once this component mounts with a parsed tag in
 * hand, so a site with no sticky banner configured never fetches it. It is a
 * module-level singleton: several ExoClick display placements would otherwise
 * each add their own copy of the same script.
 */

/** One shared load of ExoClick's provider, for the whole page. */
let providerPromise: Promise<boolean> | null = null;

function loadProvider(): Promise<boolean> {
  providerPromise ??= new Promise<boolean>((resolve) => {
    if (typeof document === "undefined") {
      resolve(false);
      return;
    }
    if (document.querySelector(`script[src="${EXOCLICK_PROVIDER_SRC}"]`)) {
      resolve(true);
      return;
    }
    const el = document.createElement("script");
    el.async = true;
    el.type = "application/javascript";
    el.src = EXOCLICK_PROVIDER_SRC;
    /*
      Resolves FALSE rather than rejecting. An ad blocker is the common case, not
      an exceptional one, and a rejection would leave the waiting unit unresolved
      forever instead of quietly giving up.
    */
    el.onload = () => resolve(true);
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
  });
  return providerPromise;
}

declare global {
  interface Window {
    AdProvider?: unknown[];
  }
}

/**
 * Which configured ins-tag this instance renders.
 *
 * `sticky` pins itself to the viewport; `history` is an outstream video that
 * sits in the page. Both are the same ExoClick DISPLAY mechanism — an <ins>
 * their loader fills — so they share one component rather than two that drift.
 */
export type ExoClickInsSlot = "sticky" | "history";

export function ExoClickSticky({ slot = "sticky" }: { slot?: ExoClickInsSlot } = {}) {
  /*
    Resolves its OWN tag from the public config rather than taking a prop.
    The furniture that mounts it is shared by ~150 marketing routes, and
    threading an ad detail through every one of them to reach one component is
    how a placement ends up half-wired. One cached request, once per page.
  */
  const [tag, setTag] = useState<ExoClickStickyTag | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: Record<string, ExoClickStickyTag | null | undefined>) => {
        if (alive) setTag((slot === "history" ? d.exoclickHistory : d.exoclickSticky) ?? null);
      })
      .catch(() => {
        /* No sticky banner is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, [slot]);

  const { showAds, ready } = useShowAds();
  const host = useRef<HTMLModElement | null>(null);
  const served = useRef(false);
  const [mounted, setMounted] = useState(false);

  // Client-only: the provider touches `document` and `window.AdProvider`, and a
  // sticky unit has no business existing in server-rendered HTML.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !ready || !showAds || !tag || served.current) return;
    const el = host.current;
    if (!el) return;
    served.current = true;

    void loadProvider().then((ok) => {
      if (!ok) return;
      try {
        // Tells the loader to fill every placeholder it has not filled yet.
        (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
      } catch {
        /* A broken provider must never take a page down over a banner. */
      }
    });
  }, [mounted, ready, showAds, tag]);

  // Premium visitors, an unresolved plan, or nothing configured: render nothing
  // at all — not even the placeholder, which is what the loader would fill.
  if (!mounted || !ready || !showAds || !tag) return null;

  /*
    A real `<ins>` built from two validated values, never the pasted markup.
    `display:contents` keeps the host out of the layout entirely: the banner
    positions itself, so this element must not occupy or reserve any space.
  */
  return (
    <ins
      ref={host}
      className={tag.cls}
      data-zoneid={tag.zoneId}
      /*
        , not .

        While this was page-wide furniture it had to add no box at all. Anchored
        to the result card it is the opposite: it needs its own space above the
        thumbnail, or the creative would overlap the video it sits on top of.
      */
      style={{ display: "block", width: "100%" }}
    />
  );
}

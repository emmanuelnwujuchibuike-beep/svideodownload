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
  /** True once ExoClick has actually put something inside the placeholder. */
  const [filled, setFilled] = useState(false);

  // Client-only: the provider touches `document` and `window.AdProvider`, and a
  // sticky unit has no business existing in server-rendered HTML.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !ready || !showAds || !tag || served.current) return;
    const el = host.current;
    if (!el) return;
    served.current = true;

    /*
      🔴 RESERVE NOTHING UNTIL IT ACTUALLY FILLS (owner, 2026-08-30: "history
      page video outstream is just showing blank").

      Giving the outstream slot a 16:9 box fixed the 0px collapse and created a
      worse bug: when ExoClick does not fill, that box is a large empty hole in
      the middle of the page — which is exactly what the owner screenshotted,
      between the column-count control and the first day group.

      So the height is now EARNED. The element starts with no reserved size, and
      only takes the 16:9 box once a child actually appears inside it. Same
      technique the VAST player uses for its own fill detection, and the same
      rule the ad-slot suite exists to enforce: never draw a box around nothing.
    */
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (el.childElementCount > 0) {
        setFilled(true);
        observer.disconnect();
        if (timer) clearTimeout(timer);
      }
    });
    observer.observe(el, { childList: true });

    void loadProvider().then((ok) => {
      if (!ok) {
        observer.disconnect();
        return;
      }
      try {
        // Tells the loader to fill every placeholder it has not filled yet.
        (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
      } catch {
        /* A broken provider must never take a page down over a banner. */
      }
      // Already filled between render and this callback.
      if (el.childElementCount > 0) {
        setFilled(true);
        observer.disconnect();
        return;
      }
      // Give up quietly rather than hold a hole open forever.
      timer = setTimeout(() => observer.disconnect(), 8000);
    });

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
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
        🔴 The HISTORY slot needs a SIZED box (owner, 2026-08-30: "download
        history outstream is not showing, is suppose to be showing
        horizontally").

        Config was verified correct and live — the tag parses to
        eas6a97888e37 / 6015590 — so the ins element was rendering with the
        right values and simply had no height. An outstream unit fills its
        container, and a display-block element with a width but no height
        collapses to 0px: present in the DOM, invisible on the page. Exactly
        the kind of silent nothing this integration keeps producing.

        16:9 with a floor, because outstream is a HORIZONTAL format — that is
        the shape the owner is expecting, and it is what stops the box being
        the wrong aspect while the creative loads.

        The STICKY slot keeps no size at all: it pins itself and must add no box.
      */
      style={
        slot === "history" && filled
          ? { display: "block", width: "100%", aspectRatio: "16 / 9", minHeight: 180 }
          : { display: "block", width: "100%" }
      }
    />
  );
}

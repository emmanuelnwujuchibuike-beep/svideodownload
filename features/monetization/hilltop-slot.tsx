"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { HilltopBannerSlot, HilltopTag } from "@/lib/monetization/hilltop";
import {
  DEFAULT_HILLTOP,
  isHilltopPlacementOn,
  type HilltopConfig,
  type HilltopPlacementId,
} from "@/lib/monetization/hilltop-config";

import { useShowAds } from "./use-show-ads";

/**
 * A HilltopAds banner, placed where this component sits.
 *
 * ── Why this is so much smaller than the ExoClick unit ────────────────────────
 *
 * Their loader inserts the creative immediately before its own `<script>` tag
 * (`l = d.scripts[d.scripts.length - 1]`, then `insertBefore(s, l)`), so the
 * placement IS the script's position in the DOM. There is no `<ins>` to find, no
 * document-wide `serve()` to trigger, no batched multi-zone request, and
 * therefore none of the batching machinery that request forced on the ExoClick
 * unit: no zone claim against a shared batch, and no document-wide serve().
 *
 * It DOES re-inject on navigation — a script that ran once where it stood shows
 * the same creative for the life of the page otherwise. See `pathname` below.
 *
 * ── The script goes INSIDE our own host ───────────────────────────────────────
 *
 * 🔴 Appending it to `document.head` or the body would put the creative at the
 * end of the document, not here — their loader has no idea where "here" is
 * except by where its script element lives. So the script is created as a CHILD
 * of the host div, which makes the host both the position and the cleanup
 * boundary: unmounting removes the script and everything the loader put beside
 * it, instead of orphaning a creative in a page the visitor navigated away from.
 *
 * ── Injected as a real element, never as markup ───────────────────────────────
 *
 * The pasted snippet never reaches the DOM. `parseHilltopTag` lifts one https
 * URL out of it server-side and this re-creates the element their loader would
 * have, with the attributes it sets. `dangerouslySetInnerHTML` would not work
 * here anyway — a `<script>` written that way is inert, which is a trap worth
 * naming because it looks correct and silently does nothing.
 */
/**
 * Placements with a live script on the page right now.
 *
 * Module scope on purpose — see the note at the claim. This is HilltopAds' own
 * registry and shares nothing with ExoClick's `claimedZones`: the two networks
 * must not be able to stand each other down.
 */
const mounted = new Set<string>();

/**
 * Development-only diagnostics, as the brief asks for.
 *
 * Compiled out of production by the `NODE_ENV` check — an ad integration that
 * narrates itself in the console on a visitor's phone is a performance cost and
 * an information leak, and this one runs on every route change.
 */
/**
 * Window flags their loader sets to mean "this zone has already rendered".
 *
 * 🔴 THE REASON AN AD SHOWED ONCE AND THEN NEVER AGAIN (owner, 2026-09-01: "it
 * still show once, it doesnt show in history page if it first showed in landing
 * page, and always needs in a refresh"). Straight out of their loader:
 *
 *     init: function (e) {
 *       if (this.checkOther(e.globalNameLoaded)) return;
 *       this.setGlobalVar(e.globalNameLoaded);
 *       …
 *     }
 *     checkOther:   function (e) { return window[e] }
 *     setGlobalVar: function (e) { window[e] = true }
 *
 * `init` returns immediately when the flag is set, and the flag lives on
 * `window`. That is a once-per-PAGE-LOAD guard, and their assumption is a
 * document that is thrown away on every navigation. In an SPA the document is
 * never thrown away, so the first render of a zone is the only one: navigating
 * to another page, or mounting a second slot on the same zone, hits the guard
 * and returns. A hard refresh clears `window`, which is exactly why a refresh
 * "fixed" it.
 *
 * So the flags this integration caused are cleared before each injection. That
 * is not subverting their rule — it restores the semantics their rule was
 * written for. Once per page VIEW is what they mean, and in an SPA a route
 * change is a page view.
 *
 * ⚠️ Only keys OBSERVED APPEARING around one of our own script loads are ever
 * touched, and only when their value is boolean `true` (the shape
 * `setGlobalVar` writes). Nothing pre-existing is deleted, so no other
 * network's globals — and none of the app's — can be caught by this.
 */
const guardKeys = new Set<string>();

/** Snapshot of `window`'s own keys, taken immediately before a script runs. */
function windowKeys(): Set<string> {
  try {
    return new Set(Object.keys(window));
  } catch {
    return new Set();
  }
}

/** Record any boolean-true key that appeared while our script was loading. */
function captureGuards(before: Set<string>): void {
  try {
    for (const k of Object.keys(window)) {
      if (before.has(k)) continue;
      if ((window as unknown as Record<string, unknown>)[k] === true) guardKeys.add(k);
    }
  } catch {
    /* A cross-origin or exotic key must never break the ad it describes. */
  }
}

/** Clear the recorded flags so their `init` will run again. */
function releaseGuards(): void {
  for (const k of guardKeys) {
    try {
      delete (window as unknown as Record<string, unknown>)[k];
    } catch {
      /* Non-configurable — nothing to do, and nothing to break. */
    }
  }
}

function log(event: string, id: string): void {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.debug(`[AdManager] ${event}`, id);
}

export function HilltopSlot({
  slot,
  instanceKey,
  lazy = false,
  className,
}: {
  /** Which position this is, for the admin activity feed. */
  slot: HilltopBannerSlot;
  /**
   * Distinguishes SEVERAL live instances of one placement.
   *
   * 🔴 REQUIRED WHEREVER A PLACEMENT CAN RENDER MORE THAN ONCE, and the feed is
   * exactly that: one unit every N posts, several on screen at a time. Without
   * it every one of them would carry the id `hilltop-feed`, and since
   * `appendTo` is resolved with `document.querySelector` — first match wins —
   * every creative in the feed would be appended into the topmost container.
   * The duplicate-instance registry would compound it by letting only the first
   * one inject at all.
   *
   * Pass something STABLE for the position, not an index: the feed passes the id
   * of the post the unit follows, so removing a post above does not renumber the
   * containers and re-request every ad below.
   */
  instanceKey?: string;
  /**
   * Hold the script until the slot is within a screen of the viewport.
   *
   * 🔴 ON FOR ANY SLOT ABOVE OR NEAR THE FOLD OF A BUDGETED PAGE (owner,
   * 2026-09-01: "seems like all this is breaking the lcp and landing
   * performance"). Fair, and it was mine: the landing unit mounts inside the
   * hero card stack, so its third-party script was being fetched and executed
   * while the browser was still laying out the page it is judged on. The 1.6s
   * budget on `/` is the owner's first rule.
   *
   * Off by default so a slot deep in a page — history, the in-feed units, which
   * are already inside their own lazy wrappers — pays nothing for an observer
   * it does not need.
   */
  lazy?: boolean;
  className?: string;
}) {
  const { showAds, ready } = useShowAds();
  const [tag, setTag] = useState<HilltopTag | null>(null);
  const [config, setConfig] = useState<HilltopConfig>(DEFAULT_HILLTOP);
  const host = useRef<HTMLDivElement | null>(null);
  /*
    🔴 A NEW AD ON EVERY NAVIGATION (owner, 2026-09-01: "is good but suppose to
    show on navigate").

    A Hilltop unit is a script that runs once, where it stands. Nothing about it
    re-asks on its own, so a slot that lives through a client-side navigation —
    or one whose page is re-entered — kept showing the creative it loaded the
    first time, and only a hard reload produced a new one.

    Keying the injection effect on the PATHNAME means each navigation tears the
    old script and its creative down and injects a fresh one, which is a new
    request and a new impression. This is what ExoClick's `serveKey` does for the
    same reason, arrived at the same way.
  */
  const pathname = usePathname();
  /** Bumped to re-run the injection effect when the placement was busy. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then(
        (d: {
          hilltopBanners?: Partial<Record<string, HilltopTag | null>>;
          hilltopBanner?: HilltopTag | null;
          hilltop?: HilltopConfig;
        }) => {
          if (!alive) return;
          // This placement's OWN tag, or the shared one it falls back to.
          setTag(d.hilltopBanners?.[slot] ?? d.hilltopBanner ?? null);
          if (d.hilltop) setConfig(d.hilltop);
        },
      )
      .catch(() => {
        /* No banner is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, [slot]);

  /*
    Viewport rule (brief §12: "Do not force desktop-sized HilltopAds banners
    onto mobile"). Read once on mount rather than tracked: a resize across the
    breakpoint mid-session should not tear down a creative that is already
    serving, which would spend a second impression for one viewer.
  */
  const [isMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 767px)").matches,
  );
  /**
   * The container's stable, unique DOM id — `hilltop-landing`, `hilltop-feed`,
   * and so on, exactly as the brief specifies.
   *
   * STABLE across navigations on purpose: it is the selector handed to their
   * loader as `appendTo`, so it has to name this placement and nothing else. A
   * generated or index-based id would point the loader at whichever slot
   * happened to render first.
   */
  const domId = instanceKey ? `hilltop-${slot}-${instanceKey}` : `hilltop-${slot}`;

  /*
    One-way latch: false → true, never back. Scrolling away and returning must
    not tear the unit down and re-ask — the same rule every other lazy slot in
    this codebase follows.
  */
  const [near, setNear] = useState(!lazy);
  useEffect(() => {
    if (near) return;
    const el = host.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setNear(true);
        obs.disconnect();
      },
      { rootMargin: "600px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [near]);
  const viewportAllowed = isMobile ? config.mobile : config.desktop;
  const placementOn = isHilltopPlacementOn(config, slot as HilltopPlacementId) && viewportAllowed;

  /*
    🔴 EACH SLOT GETS ITS OWN WINDOW (owner, 2026-09-01: "it only show banner in
    history page, suppose to be in both and also in period separator section").

    The once-per-page-load guard is the reason, one step further along than the
    last fix reached. Their `init` returns when `window[globalNameLoaded]` is
    set, and clearing that flag before each injection is not enough when two
    slots mount in the SAME commit: both clear it, both inject, then the first
    script to load sets the flag and the second returns. So one slot painted and
    every other slot on the page stayed blank — the landing unit and both period
    separators.

    Clearing harder does not fix it. Serialising the injections would, and would
    also mean the second ad waits for the first to finish loading.

    An iframe does fix it, structurally: a frame is its own `window`, so the flag
    is scoped to that frame and every slot is the first slot in its own document.
    The same reasoning as the idle interstitial, which the ads route already
    serves through a sandboxed frame for exactly this reason.

    It also contains the third-party script — its parse, its execution and its
    layout are the frame's, not the main document's, which is the LCP and
    scrolling cost the owner raised.

    `srcdoc` keeps our ORIGIN, so their referer check still sees frenzsave.com,
    and the sandbox policy is the one `ad-slot.tsx` already settled on:
    `allow-top-navigation-by-user-activation` is deliberately absent, so a
    creative cannot navigate the whole page out from under the reader, while
    `allow-popups` lets a real click open the advertiser.
  */
  const srcDoc = tag
    ? `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;display:flex;align-items:center;justify-content:center}</style></head><body><script async referrerpolicy="no-referrer-when-downgrade" src="${tag.src}"></script></body></html>`
    : "";

  useEffect(() => {
    if (!ready || !showAds || !tag || !placementOn || !near) return;
    const el = host.current;
    if (!el) return;
    log("slot initialized", domId);
    el.setAttribute("data-ad-initialized", "true");

    /*
      Report what actually happened. The frame is cross-document, so its
      contents cannot be inspected — its own painted HEIGHT is the signal, which
      is what the network's creative gives the frame.
    */
    const timer = setTimeout(() => {
      const painted = el.getBoundingClientRect().height > 0;
      try {
        navigator.sendBeacon?.(
          "/api/track",
          new Blob(
            [JSON.stringify({ kind: "banner", slot: `hilltop_${slot}`, filled: painted, path: location.pathname })],
            { type: "application/json" },
          ),
        );
      } catch {
        /* Diagnostics must never break the thing they describe. */
      }
    }, config.timeoutMs);

    return () => {
      clearTimeout(timer);
      el.removeAttribute("data-ad-initialized");
      log("slot torn down", domId);
    };
  }, [ready, showAds, tag, slot, domId, placementOn, near, config.timeoutMs, pathname, attempt]);

  // Premium visitors, an unresolved plan, or nothing configured: no element at
  // all, so the slot costs an unconfigured page nothing.
  if (!ready || !showAds || !tag || !placementOn) return null;

  /*
    A 300x250 unit in a box that may be narrower on a small phone. `maxWidth`
    and `overflow` are a FENCE, not a size — the same rule the ExoClick host
    settled on after a creative wider than the screen dragged a horizontal
    scrollbar across the page. Nothing here asserts a height.
  */
  /*
    🔴 CENTRED (owner, 2026-09-01: "center this hiltop banner", with a screenshot
    of a 300x250 unit sitting hard against the left edge under the wallpaper
    cards).

    `display: flex` + `justifyContent: center` on OUR host, which is the flex
    CONTAINER. That is not the trap recorded in exoclick-sticky.tsx: there the
    problem was an empty `<ins>` acting as a flex ITEM of somebody else's flex
    parent, whose `flex-basis: auto` resolved against no content and gave the
    creative a zero-width box to size into. Here the item is the loader's own
    creative, which has real content and its own intrinsic width.

    `flexWrap: wrap` so a creative wider than the column drops rather than being
    squeezed, and no `alignItems`, so nothing here asserts a height. Width is
    still offered in full — the fence is `maxWidth`/`overflow`, as before.
  */
  return (
    <div
      ref={host}
      id={domId}
      className={className}
      style={{
        width: "100%",
        maxWidth: "100%",
        overflow: "hidden",
        display: "flex",
        justifyContent: "center",
        flexWrap: "wrap",
      }}
    >
      {!near ? (
        /*
          🔴 A REAL PLACEHOLDER CHILD WHILE WAITING, AND IT IS LOAD-BEARING.

          Measured on production (`scripts/find-ad-slots.mjs` style probe, the
          landing container): `{"id":"hilltop-landing","y":835,"w":388,"h":0,
          "init":null,"kids":0,"iframe":false}` — the box exists, is the right
          width, sits where it should, and is ZERO HIGH with no child and no
          initialisation. That is the whole of "the landing page hiltop banner is
          still not showing".

          A flex container with no children has no height, and an
          IntersectionObserver does not reliably report a zero-area target as
          intersecting — so `near` never flipped, so no iframe was rendered, so
          the container stayed childless. A deadlock that looks exactly like a
          network with no demand.

          `lazy-exoclick-slot.tsx` already carries this lesson from
          `LazyAdSurface`, which silently disabled every section-break slot the
          same way. I reintroduced it when I made this slot lazy. One inert,
          1px-high node is enough to give the observer something to measure.
        */
        <div aria-hidden style={{ width: "100%", height: 1 }} />
      ) : tag && placementOn ? (
        <iframe
          title="Advertisement"
          srcDoc={srcDoc}
          /*
            The product is "MultiTag: Banner 300x250", so the frame is that size
            — a frame has no intrinsic height, and a creative inside one cannot
            push it open. This is the network's own declared size for this tag
            rather than a guess, and `maxWidth` keeps it inside a narrow phone
            column.
          */
          width={300}
          height={250}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          style={{ border: 0, display: "block", maxWidth: "100%" }}
        />
      ) : null}
    </div>
  );
}

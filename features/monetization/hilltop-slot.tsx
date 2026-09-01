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

export function HilltopSlot({
  slot,
  className,
}: {
  /** Which position this is, for the admin activity feed. */
  slot: HilltopBannerSlot;
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
      .then((d: { hilltopBanner?: HilltopTag | null; hilltop?: HilltopConfig }) => {
        if (!alive) return;
        setTag(d.hilltopBanner ?? null);
        if (d.hilltop) setConfig(d.hilltop);
      })
      .catch(() => {
        /* No banner is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, []);

  /*
    Viewport rule (brief §12: "Do not force desktop-sized HilltopAds banners
    onto mobile"). Read once on mount rather than tracked: a resize across the
    breakpoint mid-session should not tear down a creative that is already
    serving, which would spend a second impression for one viewer.
  */
  const [isMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 767px)").matches,
  );
  const viewportAllowed = isMobile ? config.mobile : config.desktop;
  const placementOn = isHilltopPlacementOn(config, slot as HilltopPlacementId) && viewportAllowed;

  useEffect(() => {
    if (!ready || !showAds || !tag || !placementOn) return;
    const el = host.current;
    if (!el) return;

    /*
      🔴 ONE LIVE INSTANCE PER PLACEMENT (brief §11: "Never allow the same
      HilltopAds placement to mount twice … duplicate ads caused by React Strict
      Mode … duplicate ads after navigation").

      A module-level registry rather than a ref, because a ref is per-instance
      and would not see a SECOND instance of the same placement — which is
      exactly what a strict-mode double mount, or two renders of one component,
      produces. Claiming is the first thing this effect does and releasing is
      the last thing its cleanup does, so a navigation hands the placement back.
    */
    /*
      🔴 A CLAIMED SLOT RETRIES, IT DOES NOT GIVE UP FOR EVER (owner,
      2026-09-01: "the banner only serve once and needs refresh to show").

      This was a bare `if (mounted.has(slot)) return`, and that is precisely the
      bug. React mounts the incoming tree before it runs the outgoing one's
      cleanup, so on a navigation the NEW instance of a slot can find the OLD
      one's claim still standing. It returned, registered no cleanup, and its
      effect had no reason to run again — so the slot stayed blank until a hard
      reload, on every page after the first.

      The guard still prevents two live scripts for one placement, which is what
      it is for. It just no longer treats "busy right now" as "never".
    */
    if (mounted.has(slot)) {
      const retry = setTimeout(() => setAttempt((n) => n + 1), 250);
      return () => clearTimeout(retry);
    }
    mounted.add(slot);

    const script = document.createElement("script");
    script.src = tag.src;
    script.async = true;
    script.referrerPolicy = tag.referrerPolicy;
    /*
      Their snippet sets `s.settings = {}` before insertion. It is the object
      their loader reads its per-tag options from, and an absent one has been
      observed to throw inside minified loaders that assume it. Empty is what
      the pasted snippet passes.
    */
    (script as HTMLScriptElement & { settings?: unknown }).settings = {};
    el.appendChild(script);

    /*
      Report what actually happened, on the same 10s window the ExoClick unit
      uses. This is the only way to tell "the network had nothing" from "the
      slot never rendered" from outside the browser — the distinction that took
      a full day to establish for ExoClick, and it is wired from the start here.
    */
    const timer = setTimeout(() => {
      const painted = el.getBoundingClientRect().height > 0 || !!el.querySelector("iframe, img, video, a[href]");
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
      mounted.delete(slot);
      // Take the loader's own nodes down with us — see the header.
      el.replaceChildren();
    };
  }, [ready, showAds, tag, slot, placementOn, config.timeoutMs, pathname, attempt]);

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
      className={className}
      style={{
        width: "100%",
        maxWidth: "100%",
        overflow: "hidden",
        display: "flex",
        justifyContent: "center",
        flexWrap: "wrap",
      }}
    />
  );
}

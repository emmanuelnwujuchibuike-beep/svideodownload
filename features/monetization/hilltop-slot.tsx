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
function log(event: string, id: string): void {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.debug(`[AdManager] ${event}`, id);
}

export function HilltopSlot({
  slot,
  instanceKey,
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
    if (el.getAttribute("data-ad-initialized") === "true") {
      log("slot already initialized", domId);
      return;
    }
    log("slot detected", domId);

    if (mounted.has(domId)) {
      log("provider busy, queued", domId);
      /*
        Bounded. The claim is released by the other instance's cleanup, which
        runs in the same commit — a handful of retries covers that comfortably,
        and an unbounded loop would spin for the life of the page if a claim
        ever leaked.
      */
      if (attempt > 8) return;
      const retry = setTimeout(() => setAttempt((n) => n + 1), 250);
      return () => clearTimeout(retry);
    }
    mounted.add(domId);

    /*
      🔴 `appendTo` — THE FIX, AND IT IS THEIR OWN API (owner, 2026-09-01: "think
      this caching and nav issue not ad network", which is exactly right).

      Read out of their minified loader rather than guessed at:

          saveScriptTag: function (e) {
            for (var n = document.querySelectorAll('script[src*="' + e + '"]'), t = 0; t < n.length; t++)
              if (!n[t].used) { this.settings.script = n[t]; n[t].used = true; break }
          }

          _injectDOM: function () {
            var n = document.querySelector(this.settings.appendTo), e = this.settings.script;
            n ? n.appendChild(this.adElement)
              : e && !e.closest("head") ? e.insertBefore(…)
          }

          copyUserSettings: … typeof e.appendTo !== "undefined" && (this.settings.appendTo = e.appendTo)

      So by default the loader FINDS ITSELF by scanning the document for a script
      whose src matches, taking the first one not already flagged `used`, and
      then places the creative next to THAT element. Three consequences, and they
      are the three symptoms reported:

        • Several slots on one page all match the same selector, so the ads are
          handed out in document order to whichever script the scan reaches
          first — "only the first ad slot initializes".
        • After an SPA navigation the scan runs against a document that still
          holds scripts from the page just left, so a fresh slot can be matched
          to a stale element and the creative is appended somewhere the reader is
          no longer looking — "empty until a full refresh".
        • None of it is deterministic, which is why it worked on the landing page
          and not after navigating.

      `copyUserSettings` reads `appendTo` off the script element — that is the
      supported way to say WHERE, and it takes precedence over the whole scan.
      Given an explicit container selector the loader calls
      `document.querySelector(appendTo).appendChild(...)` and script position
      stops mattering entirely.
    */
    el.id = domId;
    const script = document.createElement("script");
    script.src = tag.src;
    script.async = true;
    script.referrerPolicy = tag.referrerPolicy;
    /*
      Their snippet sets `s.settings = {}` before insertion — the object their
      loader reads its per-tag options from. Ours carries the one option that
      makes the placement deterministic.
    */
    (script as HTMLScriptElement & { settings?: unknown }).settings = { appendTo: `#${domId}` };
    el.appendChild(script);
    // Per-slot initialisation state, readable from the DOM as the brief asks.
    el.setAttribute("data-ad-initialized", "true");
    log("slot initialized", domId);

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
      mounted.delete(domId);
      /*
        Take the loader's own nodes down with us, and clear the initialisation
        flag so THIS placement can be built again when the route is revisited —
        the brief's "an ad container that is removed during navigation can be
        safely re-created and initialized when that page is visited again".
      */
      el.removeAttribute("data-ad-initialized");
      el.replaceChildren();
      log("slot torn down", domId);
    };
  }, [ready, showAds, tag, slot, domId, placementOn, config.timeoutMs, pathname, attempt]);

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
    />
  );
}

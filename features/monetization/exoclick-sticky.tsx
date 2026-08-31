"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  EXOCLICK_PROVIDER_SRC,
  type ExoClickStickyTag,
} from "@/lib/monetization/exoclick-sticky";
import { cn } from "@/lib/utils";

import { useShowAds } from "./use-show-ads";

/**
 * The ExoClick DISPLAY banners — the product their `ad-provider.js` places.
 *
 * ── What their loader ACTUALLY does (measured, 2026-08-31) ────────────────────
 *
 * Everything below follows from reading the real minified `ad-provider.js` and
 * then driving it in a headless browser (`scripts/exoclick-loader-probe.mjs`).
 * Two findings, both of which contradict what this file used to assume:
 *
 *  1. 🔴 THE CREATIVE IS NOT PUT INSIDE THE `<ins>`. It goes into a NEW `<div>`
 *     inserted as a SIBLING *before* it:
 *
 *         K = function (ins, domain) { …
 *           var i = document.createElement("div");
 *           ins.parentElement.insertBefore(i, ins);   // ← sibling, not child
 *           Q({ zone: …, where: i, insElement: ins });
 *           ins.setAttribute("data-processed", true);
 *         }
 *
 *     The probe confirms it: after a serve the parent holds
 *     `["DIV", "INS.eas…"]`, the `<ins>` still has `childElementCount === 0`,
 *     and a `MutationObserver` on the `<ins>` never fires once.
 *
 *     Two bugs fell out of that. The fill detection watched the `<ins>`, so
 *     `filled` was permanently `false` and the "height is earned" rule could
 *     never grant the height it exists to grant. And every centring/width rule
 *     was set on the `<ins>` — a permanently EMPTY element — which is why three
 *     separate rounds of "centre this banner and make it full width" changed
 *     nothing on screen. They were styling the wrong box.
 *
 *  2. 🟢 RE-SERVING WORKS. The standing hypothesis was that the loader only
 *     fills placeholders it discovered at its own initialisation, which would
 *     make this unfixable without a reload. That is FALSE. `serve` re-queries
 *     the document every time:
 *
 *         ne = function (params, domain) {
 *           for (const el of document.querySelectorAll(X(domain).join(",")))
 *             …K(el, domain);      // X() ends every selector with
 *         }                        // :not([data-processed=true])
 *
 *     The probe drove mount → serve → unmount → remount → serve, and the loader
 *     logged `Request #0` and then `Request #1`, the second for the new element.
 *     A fresh, unstamped `<ins>` is all it takes.
 *
 * ── Which is what fixes "shows once, then only after a reload" ────────────────
 *
 * Owner, 2026-08-31: "history banner ad shows only once and doesnt show on
 * repeated entery of the history page unless the page is reloaded", and then:
 * "the bottom banner have same issue … mostly on signed in download pages".
 *
 * Given finding 2, the missing piece was on OUR side: nothing ever re-served.
 *
 *  • `served.current` was a one-shot latch, so an instance served exactly once
 *    in its life. The bottom-nav banner is mounted from a bar that SURVIVES
 *    client-side navigation, so that one serve was the only one it would ever
 *    get — a reload really was the only way to get another.
 *  • `data-processed="true"` is written by the loader onto a React-owned node.
 *    Any path that re-uses that DOM node instead of recreating it is invisible
 *    to the loader from then on.
 *
 * So the `<ins>` is no longer React's to own. React renders an empty HOST and
 * the effect below builds the `<ins>` inside it imperatively, keyed on the
 * pathname: every navigation tears the old one down and puts a brand-new,
 * unstamped placeholder in its place, then serves it. That is exactly the state
 * a reload produces — the state the owner reports as working.
 *
 * It also keeps the loader's sibling `<div>` INSIDE our host rather than loose
 * among React's own children, so it can be styled and observed, and it is torn
 * down with the host instead of orphaned into a parent React still believes it
 * owns.
 *
 * ── Lazy by construction ──────────────────────────────────────────────────────
 *
 * The loader is only appended once this component mounts with a parsed tag in
 * hand, so a site with no ExoClick banner configured never fetches it. It stays
 * a module-level singleton: several display placements would otherwise each add
 * their own copy of the same script.
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
 * sits in the page; `bottomnav` is the banner docked above the bottom nav,
 * configured separately from the `bottom_banner` AD ZONE so ExoClick and
 * Adsterra can both run rather than competing for one slot. All three are the
 * same ExoClick DISPLAY mechanism — an <ins> their loader fills — so they share
 * one component rather than three that drift apart.
 */
export type ExoClickInsSlot = "sticky" | "history" | "bottomnav";

/**
 * Has the loader actually put a CREATIVE in the host?
 *
 * Not "are there child nodes": the loader inserts its wrapper `<div>` and a
 * `<style>` tag the instant it processes the placeholder, and leaves both there
 * even when the response is `no ads to display` — the probe captures exactly
 * that, a 217-byte, zero-height wrapper. Counting those as a fill is how a slot
 * ends up reserving a box around nothing, which is the one rule this
 * integration keeps breaking.
 *
 * So it asks for something a creative is actually made of, or for real painted
 * height. Either is proof; neither can be produced by the empty scaffolding.
 */
function hasCreative(host: HTMLElement): boolean {
  if (host.querySelector("iframe, video, img, canvas, object, embed, a[href]")) return true;
  return host.offsetHeight > 0;
}

export function ExoClickSticky({
  slot = "sticky",
  onFill,
}: {
  slot?: ExoClickInsSlot;
  /**
   * Whether a creative is actually on screen in this host.
   *
   * Reported so the bar that CONTAINS this unit can tell "a banner is
   * configured" from "a banner is showing" — the difference between docking a
   * real ad and drawing an empty white line above the nav. Fires false on
   * teardown and on the give-up timeout, so a bar can collapse again.
   */
  onFill?: (filled: boolean) => void;
} = {}) {
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
        if (!alive) return;
        const bySlot =
          slot === "history" ? d.exoclickHistory : slot === "bottomnav" ? d.exoclickBottomNav : d.exoclickSticky;
        setTag(bySlot ?? null);
      })
      .catch(() => {
        /* No banner is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, [slot]);

  const { showAds, ready } = useShowAds();
  const host = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  /** True once ExoClick has actually put a creative in the host. */
  const [filled, setFilled] = useState(false);
  /*
    Held in a ref, not a dependency: `onFill` is an inline arrow at the call
    site, so depending on it would tear down and re-serve the placeholder on
    every parent render — which is an ad request per render.
  */
  const fillCb = useRef(onFill);
  fillCb.current = onFill;

  /*
    🔴 THE RE-SERVE TRIGGER (owner, 2026-08-31).

    A pathname change is what a reload is, minus the reload — a new pageview,
    which is the unit a banner impression is sold in. Including it here is the
    whole fix for the mount that never unmounts: the bottom-nav bar lives in a
    bar shared across routes, so without this it serves once per full page load
    and never again, which is precisely the report.

    For the history banner, whose subtree DOES unmount, this is merely redundant
    — the effect would re-run on remount regardless.
  */
  const pathname = usePathname();

  // Client-only: the provider touches `document` and `window.AdProvider`, and a
  // sticky unit has no business existing in server-rendered HTML.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !ready || !showAds || !tag) return;
    const el = host.current;
    if (!el) return;

    /*
      A FRESH placeholder every time. The loader stamps `data-processed="true"`
      on whatever it has seen and its selector excludes those forever, so
      re-using an element is the same as not having one. Building it here rather
      than in JSX also keeps React out of a subtree a third-party script mutates
      from underneath it.
    */
    setFilled(false);
    el.textContent = "";
    const ins = document.createElement("ins");
    /*
      🔴 ONLY the network's class, never ours.

      Their `K()` derives the zone TYPE from this very attribute —
      `parseInt(ins.getAttribute("class").substring(11))` — so anything appended
      to it is being fed to their parser. `cn(tag.cls, "block w-full …")` worked
      only because `parseInt` happens to stop at the first space. Our styling
      belongs on the host, which is also the element the creative lands in.
    */
    ins.className = tag.cls;
    ins.setAttribute("data-zoneid", tag.zoneId);
    ins.style.display = "block";
    ins.style.width = "100%";
    el.appendChild(ins);

    /*
      🔴 RESERVE NOTHING UNTIL IT ACTUALLY FILLS (owner, 2026-08-30: "history
      page video outstream is just showing blank").

      Giving the outstream slot a 16:9 box fixed the 0px collapse and created a
      worse bug: when ExoClick does not fill, that box is a large empty hole in
      the middle of the page — which is what the owner screenshotted, between
      the column-count control and the first day group.

      So the height is EARNED. Watched on the HOST with `subtree`, because the
      creative is injected into a wrapper beside the `<ins>` and never into the
      `<ins>` itself. Watching the `<ins>`, as this did until 2026-08-31, is
      watching an element that is empty by design.
    */
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (!hasCreative(el)) return false;
      setFilled(true);
      fillCb.current?.(true);
      observer.disconnect();
      if (timer) clearTimeout(timer);
      return true;
    };
    const observer = new MutationObserver(() => void settle());
    observer.observe(el, { childList: true, subtree: true });

    void loadProvider().then((ok) => {
      if (!ok) {
        // Blocked, or the loader could not be fetched at all.
        observer.disconnect();
        fillCb.current?.(false);
        return;
      }
      try {
        // Tells the loader to re-scan the document and fill every placeholder it
        // has not stamped yet — which, after the rebuild above, is ours.
        (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
      } catch {
        /* A broken provider must never take a page down over a banner. */
      }
      // Already filled between the rebuild and this callback.
      if (settle()) return;
      // Give up quietly rather than hold a hole open forever — and SAY so, so
      // the containing bar collapses instead of framing an empty slot.
      timer = setTimeout(() => {
        observer.disconnect();
        fillCb.current?.(false);
      }, 8000);
    });

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      fillCb.current?.(false);
      /*
        Take the loader's wrapper down with us. It is a foreign node inside a
        host React believes is empty; leaving it behind would stack one dead
        creative per navigation inside a bar that never unmounts.
      */
      el.textContent = "";
    };
  }, [mounted, ready, showAds, tag, pathname]);

  // Premium visitors, an unresolved plan, or nothing configured: render nothing
  // at all — not even the host, which is what the loader would fill.
  if (!mounted || !ready || !showAds || !tag) return null;

  /*
    The HOST. React renders it empty and never renders children into it: the
    `<ins>` and everything the loader injects beside it are managed by the effect
    above, so there is no React child list here for a third-party script to
    invalidate.

    It is also the element every visual rule belongs on, because it is the one
    the creative is actually inside.
  */
  return (
    <div
      ref={host}
      className={cn(
        /*
          🔴 CENTRED STRUCTURALLY, not by inheritance (owner, 2026-08-30: "the
          history banner is still not centered and fill", and for the bottom bar,
          2026-08-31).

          Earlier attempts centred with `text-align` and `mx-auto`. Both are
          conditional on what the loader happens to inject: `text-align` only
          moves INLINE content, and `mx-auto` only centres a BLOCK with a width —
          so a fixed-size iframe, or a div that is neither, stays hard left. We
          do not control that markup and it differs per creative.

          `flex` + `justify-center` centres ANY single child whatever its display
          type. That reasoning was already right; it was simply being applied to
          the empty `<ins>` instead of to the box the creative is in.
        */
        (slot === "history" || slot === "bottomnav") && "flex w-full items-center justify-center",
        /*
          The history slot was asked for a FULL-WIDTH horizontal outstream unit,
          so its iframe/image is stretched to the container.
        */
        slot === "history" && "[&_iframe]:!w-full [&_img]:!h-auto [&_img]:!w-full",
        /*
          The bottom-nav banner sits in a bar we control the width of, so it is
          centred — but deliberately NOT stretched: a fixed-size banner pushed
          past its natural size is a blurry banner.
        */
        slot === "bottomnav" && "[&_iframe]:!max-w-full [&_img]:!max-w-full",
      )}
      /*
        🔴 A FLOOR, NOT A FIXED ASPECT, and only ONCE SOMETHING FILLED.

        `aspectRatio: 16/9` was right for an outstream VIDEO, but the zone also
        serves fixed-size NATIVE units and forcing 16:9 onto a taller creative
        crops it. `minHeight` still gives an outstream player a box to settle
        into, and content decides the rest.

        The STICKY slot keeps no size at all: the network pins it to the viewport
        itself, so this host must not occupy or reserve any space.
      */
      style={
        slot === "history" && filled
          ? { display: "flex", width: "100%", minHeight: 180 }
          : { display: "block", width: "100%" }
      }
    />
  );
}

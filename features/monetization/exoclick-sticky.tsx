"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  EXOCLICK_PROVIDER_SRC,
  type ExoClickStickyTag,
} from "@/lib/monetization/exoclick-sticky";

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
 * the effect below builds the `<ins>` inside it imperatively, so a fresh,
 * unstamped placeholder can be produced on demand — which is the state a reload
 * produces, and the state the owner reports as working.
 *
 * 🔴 ON DEMAND, NOT ON EVERY NAVIGATION. That rebuild was briefly keyed on the
 * pathname, which meant every client-side navigation tore down a LIVE creative
 * and asked for a replacement the network frequently declines — trading a
 * working banner for a coin flip ("navigating still destroys the bottom
 * banner"). A navigation now only asks when the slot is genuinely empty; see
 * `serveKey`.
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

/**
 * One shared load of ExoClick's provider PER DOMAIN, for the whole page.
 *
 * 🔴 Keyed by src, not a single global (owner, 2026-08-31: the fullpage
 * interstitial tag is served from `a.pemsrv.com`, the banners from
 * `a.magsrv.com`). ExoClick rotates provider domains and a zone is activated
 * against the one its snippet names, so a single hardcoded loader would either
 * serve the wrong domain's zones or silently serve nothing. Still one load per
 * domain: several placements sharing a domain must not each append a copy.
 */
/**
 * How long to wait before asking again with a FRESH placeholder.
 *
 * 🔴 Was 3500ms, which was shorter than the network's own answer. Measured on
 * production (`scripts/history-ad-survival.mjs`), the outstream's markup lands
 * at ~4.5s:
 *
 *     t=3000ms  html=    55  media=0     <- <ins> placed, nothing back yet
 *     t=4500ms  html= 15926  media=1     <- creative arrives
 *
 * So the retry was firing squarely inside the response window and wiping the
 * question before the answer could arrive — and the replacement ask is then
 * frequency-capped. Well past it now, and the retry additionally refuses to
 * touch a placeholder their loader has already claimed (see the guard below).
 */
const RETRY_MS = 9000;

const providerPromises = new Map<string, Promise<boolean>>();

/**
 * ONE `serve()` per frame, however many slots asked for it.
 *
 * 🔴 EVERY EXTRA PUSH IS A WHOLE AD REQUEST, AND IT BURNS THE FREQUENCY CAP
 * (owner, 2026-09-01: "the multi format in history stop showing when i navigates
 * outs twice and come back").
 *
 * `serve` is not per-placement. Their loader re-queries the WHOLE document and
 * fills every `<ins>` it has not stamped:
 *
 *     ne = function (params, domain) {
 *       for (const el of document.querySelectorAll(X(domain).join(",")))
 *         …K(el, domain);          // X() ends every selector with
 *     }                            // :not([data-processed=true])
 *
 * So one push already covers every slot that mounted in the same tick — and
 * each instance pushing its own turned /history's four placements (the
 * above-grid unit, two in-feed units and the docked bottom-nav banner) into FOUR
 * full requests per visit. ExoClick caps impressions per visitor per zone, so a
 * couple of navigations is enough to exhaust it, which is exactly the shape of
 * "stops showing after I navigate out twice and come back".
 *
 * Coalescing to one push per frame per domain makes the number of requests match
 * the number of ROUNDS of mounting, not the number of slots. Keyed by domain
 * because a zone is activated against the provider its snippet names, and asking
 * magsrv for a pemsrv zone serves nothing.
 */
const pendingServe = new Set<string>();
let serveFrame = 0;

/**
 * Zone ids with a live placeholder on the page right now.
 *
 * 🔴 ONE `<ins>` PER ZONE PER PAGE. THE SAME ZONE TWICE SERVES NOTHING (owner,
 * 2026-09-01: "the exoclick banner and multi format is not showing", with only
 * Adsterra rendering).
 *
 * Measured on production, the live config had one zone id in THREE fields:
 *
 *     exoclickHistory     -> 6017110
 *     exoclickMultiFormat -> 6017110
 *     exoclickHistoryFeed -> 6017110
 *
 * which on /history is three placeholders for one zone: the slot above the grid
 * and both in-feed slots. Their loader batches placements into a single request
 * ("Multi-zones Batch Size: 3" in its own log) and will not serve one zone
 * several times in one call — the API answers `{"zones":[null,null]}`, which is
 * precisely the empty response I kept reading as "no demand" and reporting as a
 * network problem. Adsterra was unaffected because it has one placement and no
 * duplication, which is why it looked like an ExoClick outage.
 *
 * This is my own doing: I added the multi-format and in-feed fields without
 * anything stopping one zone filling all of them, and nothing warned the
 * operator. So the FIRST placeholder to mount claims the zone and the rest
 * render nothing at all — better one working ad than three that cancel out.
 * The admin now flags the duplication too, because the real fix is a second
 * zone id, and only the operator can create one.
 */
const claimedZones = new Map<string, number>();
let claimSeq = 0;

function requestServe(src: string): void {
  pendingServe.add(src);
  if (serveFrame) return;
  serveFrame = requestAnimationFrame(() => {
    serveFrame = 0;
    pendingServe.clear();
    try {
      // One push serves every unstamped placeholder currently in the document,
      // across every domain whose provider has loaded.
      (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
    } catch {
      /* A broken provider must never take a page down over a banner. */
    }
  });
}

export function loadProvider(src: string = EXOCLICK_PROVIDER_SRC): Promise<boolean> {
  const existing = providerPromises.get(src);
  if (existing) return existing;
  const promise = new Promise<boolean>((resolve) => {
    if (typeof document === "undefined") {
      resolve(false);
      return;
    }
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve(true);
      return;
    }
    const el = document.createElement("script");
    el.async = true;
    el.type = "application/javascript";
    el.src = src;
    /*
      Resolves FALSE rather than rejecting. An ad blocker is the common case, not
      an exceptional one, and a rejection would leave the waiting unit unresolved
      forever instead of quietly giving up.
    */
    el.onload = () => resolve(true);
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
  });
  providerPromises.set(src, promise);
  return promise;
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
 * Adsterra can both run rather than competing for one slot. `historyfeed` and
 * `historyfeedlastweek` are the two in-feed positions on /history, which need
 * separate zone ids and therefore separate slots. Every one of them is the
 * same ExoClick DISPLAY mechanism — an <ins> their loader fills — so they share
 * one component rather than three that drift apart.
 */
export type ExoClickInsSlot =
  | "sticky"
  | "history"
  | "historyfeed"
  | "historyfallback"
  | "historyfeedlastweek"
  | "landing"
  | "bottomnav";

/**
 * Report this slot's state to the operator feed (owner, 2026-08-31: "wire the
 * bottom banner ad activity to the admin live activity").
 *
 * A real fill needs an authorised referer, so this integration cannot be
 * exercised on localhost at all — every local run gets "no ads to display".
 * That is precisely why the answer has to be readable from PRODUCTION: without
 * it, "the banner did not show" is indistinguishable from "the network had
 * nothing", and both of those look like a blank space on a phone.
 *
 * `sendBeacon` so it survives the navigation that often causes the state
 * change, and so a blocked or slow request can never delay the ad it is
 * describing. Fired only on a CHANGE, never per frame.
 */
function beacon(slot: ExoClickInsSlot, filled: boolean, click = false): void {
  try {
    navigator.sendBeacon?.(
      "/api/track",
      new Blob(
        [JSON.stringify({ kind: "banner", slot, filled, click, path: location.pathname })],
        { type: "application/json" },
      ),
    );
  } catch {
    /* Diagnostics must never be able to break the thing they describe. */
  }
}

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
  /*
    🔴 THE HOST'S OWN HEIGHT IS THE WRONG QUESTION — IT MEASURES ZERO FOR A REAL,
    VISIBLE AD (production dump, 2026-08-31: `scripts/exoclick-creative-dump.mjs`).

    This was `host.offsetHeight > 0`, which replaced an even worse markup guess.
    Both were wrong, and this one was actively destructive. Injecting the sticky
    zone's tag on frenzsave.com produced THIS, inside our host:

        DIV 300x250 pos=fixed z=999999 top=20
          IMG 300x250 src=https://z6v2p9a8.bkcdn.net/library/397286/…

    A real 300x250 creative, painted, centred, on screen. Our host measured
    `412x0` the whole time — because `position: fixed` takes the creative OUT OF
    FLOW, so it contributes nothing to its parent's height. Which is not an edge
    case: it is what a sticky banner and a fullpage interstitial ARE. Every
    ExoClick product that positions itself was therefore recorded as a no-fill
    at the exact moment it succeeded.

    🔴 And a no-fill verdict is not passive here. The 3.5s retry re-serves on it,
    the effect's cleanup runs `el.textContent = ""`, and that DELETES the live
    creative — then the replacement ask is frequency-capped and declined. That is
    the mechanism behind "shows only once and doesn't show again unless the page
    is reloaded", and behind an ad that appears and vanishes seconds later.

    So the question is asked of the SUBTREE, not of the host: is there anything
    in here that is actually painting? That is true of an in-flow banner, of a
    `fixed` sticky unit, and of an outstream player once it expands, and it stays
    false for the empty scaffolding — the loader drops a wrapper `<div>` and a
    `<style>` even on a no-fill, and those measure 0.
  */
  // An IN-FLOW creative gives the host height. That is the whole test for it.
  if (host.offsetHeight > 0) return true;

  /*
    🔴 ONLY `position: fixed` DESCENDANTS COUNT FROM HERE (owner, 2026-08-31:
    "it showed banner filled in admin dashboard but nothing showed").

    This used to accept ANY descendant measuring 20x20 or more, which was too
    loose in a way that reported invisible ads as impressions — my own bug, and
    exactly what the owner saw.

    `getBoundingClientRect()` returns an element's own geometry whether or not an
    ancestor is showing it. The history outstream is precisely that case: before
    their player opens, `._effect` is `max-height: 0; overflow: hidden`, and the
    `_cta_wrapper` inside it still measures 412x48. Clipped to nothing, visible
    to no one, and counted as a fill — so the feed logged a Banner impression for
    a blank space, and the bar drew chrome around it.

    If the host itself has no height, the ONLY thing that can still be on screen
    is a creative that took itself out of flow — which is what the two units that
    actually render do (`DIV 300x250 pos=fixed z=999999` for the sticky,
    `.ex-over-top pos=fixed` for the interstitial). Anything still in flow is,
    by definition, inside the zero-height box we just measured.

    Capped so a pathological subtree can never make an observer callback
    expensive — real ad markup is a few dozen nodes.
  */
  let seen = 0;
  for (const el of host.querySelectorAll<HTMLElement>("*")) {
    if (++seen > 200) break;
    if (el.tagName === "STYLE" || el.tagName === "SCRIPT" || el.tagName === "INS") continue;
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed") continue;
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    const r = el.getBoundingClientRect();
    // A floor, not a pixel test: tracking pixels are 1x1, anything a person can
    // see clears 20x20 comfortably.
    if (r.width < 20 || r.height < 20) continue;
    /*
      And it has to be ON the screen. A fixed element parked at a negative offset
      or below the fold is as invisible as a clipped one, and reporting it would
      reintroduce the same false impression through a different door.
    */
    if (r.bottom <= 0 || r.right <= 0) continue;
    if (r.top >= window.innerHeight || r.left >= window.innerWidth) continue;
    return true;
  }
  return false;
}

/**
 * Is there a creative HERE AT ALL — painted yet or not?
 *
 * 🔴 TWO DIFFERENT QUESTIONS WERE BEING ASKED OF ONE FUNCTION, AND THE
 * DESTRUCTIVE ONE GOT THE STRICT ANSWER (owner, 2026-08-31: "no ad are showing,
 * since you fixed the ad json stringify").
 *
 * The owner pinpointed the regression to 9825998, which deleted exactly this:
 *
 *     if (host.querySelector("iframe, video, img, canvas, object, embed, a[href]"))
 *       return true;
 *
 * and replaced it with `host.offsetHeight > 0`. That markup test was NOT the
 * wrong idea — the production dump shows the sticky zone injecting a real
 * `IMG 300x250`, which it would have caught and the height test cannot.
 *
 * Two consumers, with opposite risk profiles, were sharing one verdict:
 *
 *   • "May I DESTROY this slot and ask again?" — the 3.5s retry and the
 *     navigation re-serve, both of which run `el.textContent = ""`. A false
 *     negative here DELETES A REAL AD, and the replacement ask is
 *     frequency-capped. This must be as reluctant as possible.
 *   • "Should the BAR draw its chrome?" — a false positive here paints a border
 *     and padding around nothing, which is the white line above the nav. This
 *     must be strict.
 *
 * Answering both with "is it painted right now" meant an `<iframe>` or `<img>`
 * that had been injected but had not loaded yet — 0x0 for its first moments —
 * was destroyed at 3.5 seconds, every time, before it could ever paint. So the
 * strict answer stays for the chrome, and DESTRUCTION now asks this instead:
 * is there anything here a creative is actually made of?
 *
 * The loader's no-fill scaffolding cannot trip it. On a genuine `zones:[null]`
 * it leaves only a wrapper `<div>` and a `<style>` — 304 bytes, no media
 * element, measured on production — while a served zone brings 1.4k-16k of real
 * markup with it.
 */
function hasCreativeMarkup(host: HTMLElement): boolean {
  if (host.querySelector("iframe, video, img, canvas, object, embed, a[href]")) return true;
  return hasCreative(host);
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
        /*
          🔴 ABOVE THE HISTORY GRID, THE SERVER HAS ALREADY CHOSEN.

          `exoclickHistory` is resolved in /api/ads/config from the admin switch
          (owner, 2026-09-01: "put a switch in admin dashboard to turn off and on
          so one link can serve in one slot position in the history page"), so
          this reads ONE value and cannot mount two units in one position. The
          choice deliberately does not live here: precedence expressed in the
          component is invisible to the operator who has to work out which of
          their two tags is actually running.

          Why the multi-format tag is the default side of that switch
          (`<ins class="eas6a97888e38" data-zoneid="6017110">`).

          Measured on production before wiring it — `scripts/exoclick-try-tag.mjs
          eas6a97888e38 6017110`:

              html=582  host=250px  processed=true  biggest=DIV 300x250 static
              🟢 RENDERS ON ITS OWN — no scroll needed

          That is precisely what this slot has never had. The outstream zone
          serves a real creative and then stays collapsed behind ExoClick's own
          `._effect { max-height: 0 }` until THEIR viewability function adds
          `exo_wrapper_show` — a function bound only to scroll/resize/focus. A
          reader who lands on /history and does not scroll sees nothing, by their
          design, which is the whole of "the history banner and outstream is
          still not showing".

          ONE unit above the grid, not two — stacking them is what produced the
          wrong-shaped double slot on 2026-08-30. The outstream stays as the
          FALLBACK so an operator who prefers it, or who has not pasted a
          multi-format tag, loses nothing.
        */
        const bySlot =
          slot === "history"
            ? d.exoclickHistory
            : slot === "historyfallback"
              ? d.exoclickHistoryFallback
              : slot === "historyfeed"
              ? d.exoclickHistoryFeed
              : slot === "historyfeedlastweek"
                ? d.exoclickHistoryFeedLastWeek
                : slot === "landing"
                  ? d.exoclickLanding
                  : slot === "bottomnav"
                    ? d.exoclickBottomNav
                    : d.exoclickSticky;
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
  /*
    There is deliberately no local "filled" STATE here any more. It existed only
    to drive this host's size and centring, and the host no longer has any — the
    unit decides its own dimensions and placement (owner, 2026-08-31: "let them
    decide everything"). The fill is still reported UPWARD through `fillCb`, for
    the bar that contains this unit.
  */
  /*
    Held in a ref, not a dependency: `onFill` is an inline arrow at the call
    site, so depending on it would tear down and re-serve the placeholder on
    every parent render — which is an ad request per render.
  */
  const fillCb = useRef(onFill);
  fillCb.current = onFill;

  /**
   * Bumped to ask for a NEW serve. Never bumped while a creative is on screen.
   *
   * 🔴 A NAVIGATION MUST NOT DESTROY A WORKING AD (owner, 2026-08-31:
   * "navigating still destroys the bottom banner").
   *
   * The serve effect was keyed directly on `pathname`, so every client-side
   * navigation ran its cleanup — `el.textContent = ""`, which throws away a
   * live, filled creative — and then gambled that a fresh serve would produce
   * another. ExoClick caps how often a zone serves the same visitor, so that
   * second request is frequently declined, and the bar went from showing an ad
   * to showing nothing. I had traded a real banner for a re-serve that usually
   * loses.
   *
   * A docked bar surviving a navigation with the ad it already has is the
   * normal, correct behaviour — and the state the owner is asking for. So a
   * navigation now only asks for a serve when the slot is genuinely EMPTY,
   * which is the case that needed recovering in the first place.
   */
  const [serveKey, setServeKey] = useState(0);
  /** One extra serve attempt per mount — see the retry timer below. */
  const retried = useRef(false);
  const pathname = usePathname();
  /** The first pathname is the mount, which the serve effect already handles. */
  const seenFirstPath = useRef(false);

  // Client-only: the provider touches `document` and `window.AdProvider`, and a
  // sticky unit has no business existing in server-rendered HTML.
  useEffect(() => setMounted(true), []);

  /*
    A navigation asks for a serve ONLY when there is nothing to lose — see the
    note on `serveKey`. A slot that is currently showing an ad is left entirely
    alone, cleanup included, because the cleanup is what was destroying it.

    A slot that is EMPTY still retries on every new page, which is the recovery
    the pathname trigger was added for: a zone that declined once gets another
    chance on the next route rather than staying blank until a full reload.
  */
  useEffect(() => {
    if (!seenFirstPath.current) {
      seenFirstPath.current = true;
      return;
    }
    const el = host.current;
    // Reluctant on purpose: bumping `serveKey` re-runs the effect, whose cleanup
    // wipes the host. Anything that even LOOKS like a creative is left alone.
    if (!el || hasCreativeMarkup(el)) return;
    setServeKey((k) => k + 1);
  }, [pathname]);

  useEffect(() => {
    if (!mounted || !ready || !showAds || !tag) return;
    const el = host.current;
    if (!el) return;

    /*
      🔴 CLAIM THE ZONE, OR STAND DOWN. See `claimedZones`.

      A second placeholder for a zone that already has one does not get its own
      ad — it makes the batched request ask for the same zone twice and come back
      `{"zones":[null,null]}`, so BOTH end up empty. Standing down is therefore
      strictly better than competing: one ad instead of none.

      The claim is keyed by an id, not a boolean, so this instance only ever
      releases its OWN claim on cleanup — otherwise a slot unmounting during a
      navigation would free a zone another slot is currently showing, and the
      next mount would double up again.
    */
    const claimId = ++claimSeq;
    const holder = claimedZones.get(tag.zoneId);
    if (holder !== undefined) return;
    claimedZones.set(tag.zoneId, claimId);
    const releaseClaim = () => {
      if (claimedZones.get(tag.zoneId) === claimId) claimedZones.delete(tag.zoneId);
    };

    /*
      A FRESH placeholder every time. The loader stamps `data-processed="true"`
      on whatever it has seen and its selector excludes those forever, so
      re-using an element is the same as not having one. Building it here rather
      than in JSX also keeps React out of a subtree a third-party script mutates
      from underneath it.
    */
    el.textContent = "";
    const ins = document.createElement("ins");
    /*
      🔴 ONLY the network's class, never ours.

      Their `K()` derives the zone TYPE from this very attribute —
      `parseInt(ins.getAttribute("class").substring(11))` — so anything appended
      to it is being fed to their parser. `cn(tag.cls, "block w-full …")` worked
      only because `parseInt` happens to stop at the first space.

      🔴 And no inline style either (owner, 2026-08-31: "dont give the banner or
      interstilla any artificial size or position, let them decide everything").
      This carried `display: block; width: 100%`, which is not what their own
      snippet ships — their snippet is a bare `<ins class data-zoneid>` and
      nothing more. This element is now exactly that, byte for byte, so the unit
      sizes and places itself the way it does on any other publisher's page.
    */
    ins.className = tag.cls;
    ins.setAttribute("data-zoneid", tag.zoneId);
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
    /*
      🔴 CONTINUOUS, NOT ONE-SHOT.

      The old detector ran on mutations, latched on the first positive answer and
      gave up after 8 seconds. Both halves were wrong for a network that answers
      over the wire:
        • a creative that arrives at 9s was declared a no-fill forever;
        • a creative that is REPLACED or removed (the outstream player hides
          itself when it finishes) left the bar's chrome up around nothing.
      A ResizeObserver reports both directions for as long as the unit lives, so
      the bar's chrome tracks what is actually on screen instead of a one-time
      verdict about it. It also costs nothing when nothing changes.
    */
    let last: boolean | null = null;
    /*
      The UI reacts to every change; the operator FEED does not.

      Beaconing "empty" on every state change would put one event in the live
      feed for every page view of every visitor — the feed is a place to notice
      things, and a per-pageview row is how it stops being one. So:
        • FILLED is reported the moment it happens, and cancels the timer;
        • EMPTY is reported once, and only after a grace period with nothing —
          which is the actual finding ("we asked, nothing came"), rather than
          the ordinary fact that an ad has not arrived yet;
        • an ad that fills and then GOES AWAY is reported too, because that is
          the outstream player hiding itself after one play, and it is the
          leading explanation for "shows only once".
    */
    let everFilled = false;
    const emptyTimer = setTimeout(() => {
      if (!everFilled) beacon(slot, false);
    }, 10_000);

    /*
      🔴 ONE RETRY WITH A FRESH PLACEHOLDER (owner, 2026-08-31: "the history
      above the grid still disappear after viewing ones and navigating out and
      coming back, it only reshow when i refresh").

      A re-push alone cannot work: the loader stamps `data-processed="true"` on
      the element it has seen and its selector excludes those forever, so asking
      again with the SAME <ins> is asking about an element it will not look at.
      Only a new placeholder is a new question — which is what bumping
      `serveKey` builds.

      Bounded to one attempt per mount. A slot that is empty because the network
      has nothing for this visitor must not turn into a request loop, and the
      difference between "declined" and "lost a race" is not something the
      client can tell — so it gets exactly one more chance and then stops.

      ⚠️ This is a mitigation, not the diagnosis. "It only reshows when I
      refresh" points at state inside ExoClick's own loader that a client-side
      navigation does not clear, and that is not reachable from here. The
      `banner_filled` / `banner_empty` events are what will actually say whether
      the second ask was made and what came back.
    */
    const retryTimer = setTimeout(() => {
      /*
        🔴 `hasCreativeMarkup`, NOT `hasCreative`. This branch DELETES the slot.
        An <iframe> or <img> that has been injected but has not loaded yet is
        0x0 for its first moments, and the strict test threw exactly those away
        at 3.5 seconds — every time, before they could paint.
      */
      if (hasCreativeMarkup(el) || retried.current) return;
      /*
        🔴 NEVER WIPE A REQUEST THAT IS STILL IN FLIGHT.

        `data-processed="true"` is stamped the moment their loader CLAIMS the
        placeholder, which happens well before the network answers. Measured on
        production, the outstream's markup lands at ~4.5s while this timer was
        firing at 3.5s — so the common case was: loader takes our <ins>, we throw
        it away mid-question, and the replacement ask gets frequency-capped. An
        empty slot caused by our own impatience, and it is not distinguishable
        afterwards from the network having nothing.

        The timer is now well past the observed answer window (see RETRY_MS), but
        a slow network would still race it, so an unanswered claim is left alone
        outright. If the loader never processed the element at all, a fresh one
        is the only thing that could help and this still provides it.
      */
      const ins = el.querySelector("ins[data-zoneid]");
      if (ins?.getAttribute("data-processed") === "true") return;
      retried.current = true;
      setServeKey((k) => k + 1);
    }, RETRY_MS);
    const report = () => {
      const now = hasCreative(el);
      if (now === last) return;
      last = now;
      fillCb.current?.(now);
      if (now) {
        clearTimeout(emptyTimer);
        clearTimeout(retryTimer);
        everFilled = true;
        beacon(slot, true);
      } else if (everFilled) {
        beacon(slot, false);
      }
    };
    /*
      CLICKS on the creative (owner, 2026-08-31: "the ad activity in admin
      dashboard suppose to be impression and click").

      🔴 PASSIVE, CAPTURE-PHASE, AND IT NEVER TOUCHES THE EVENT. No
      `preventDefault`, no `stopPropagation`, no re-dispatch: the click belongs
      to the network's creative and must reach it exactly as it would have. This
      only observes one going past. `passive: true` also guarantees the listener
      cannot delay the navigation the click is about to cause.

      ⚠️ It can only see clicks that land in OUR document — true for the sticky
      zone, whose creative is a plain <img>. A creative inside an <iframe> is a
      separate browsing context and its clicks are invisible to us by design, so
      a zero here is not evidence of no clicks; ExoClick's dashboard stays the
      authority. Recorded because a real click in the live feed is worth seeing
      as it happens.
    */
    const onClick = () => beacon(slot, true, true);
    el.addEventListener("pointerdown", onClick, { capture: true, passive: true });

    /*
      🔴 COALESCED TO ONE CHECK PER FRAME (owner, 2026-08-31: "the history page
      now delays to open and is now laggy … since the previous banner and
      outstream video fix").

      My regression, and an obvious one in hindsight. `report()` calls
      `hasCreative()`, which walks up to 200 nodes calling `getComputedStyle` and
      `getBoundingClientRect` — each a forced style/layout flush. It was wired
      DIRECTLY to a MutationObserver with `subtree: true`, watching an ad player
      that injects and mutates markup continuously as it initialises. So the
      scan ran many times per frame, and every run flushed layout on a page that
      was still trying to paint its grid.

      One rAF-coalesced run per frame collapses a burst of mutations into a
      single check, which is all the UI can act on anyway — nothing can change
      twice within one frame from the reader's point of view.

      The steady state is then free: once the creative is in flow the very first
      line of `hasCreative` (`host.offsetHeight > 0`) answers before any walk
      happens, so a PLAYING outstream costs one property read per frame.
    */
    let frame = 0;
    const scheduleReport = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        report();
      });
    };

    const observer = new ResizeObserver(scheduleReport);
    observer.observe(el);
    // The wrapper is inserted as a SIBLING of the <ins>, so watch the subtree
    // for it too — a child resizing does not resize the host on every layout.
    const mo = new MutationObserver(scheduleReport);
    mo.observe(el, { childList: true, subtree: true });

    /*
      🔴 LET THEIR OWN VIEWABILITY CHECK RUN. DO NOT FAKE ITS ANSWER.

      ExoClick's outstream player evaluates viewability in a function bound ONLY
      to scroll/resize/focus — it is never polled:

          m = ceil(video.getBoundingClientRect().top)
          if (m > 0 && m + halfHeight < innerHeight && focused)
              → add "exo_wrapper_show"   // releases their `max-height: 0`

      So a unit that is ALREADY in view when it loads is never assessed at all,
      and stays collapsed until the reader happens to scroll. Measured on
      /history: shut at rest, open 120px into the first scroll.

      A single synthetic `scroll`/`resize` makes that function EVALUATE. It does
      not decide the outcome — their own arithmetic still has to pass, on the
      real geometry, so an off-screen or clipped slot stays shut exactly as it
      should. This is the difference between "their rule said no" and "their rule
      was never asked", and only the second one is our bug.

      Guarded so it cannot become a nudge for something the reader cannot see:
      fired once per mount, only once their player markup exists, and only while
      the host is genuinely inside the viewport.
    */
    /*
      🔴 TEN PERCENT IS ENOUGH (owner, 2026-09-01: "make it show even if user
      sees 10% of the ad").

      An IntersectionObserver at a 0.1 threshold, NOT a polling timer. It is the
      browser telling us the moment the slot is a tenth visible, computed off the
      main thread, instead of us asking every second and paying a layout read for
      each ask — which is the cost that made the history page lag in the first
      place.

      What it triggers is still only an EVALUATION. ExoClick's own function
      decides, on the real geometry:

          m = ceil(video.top);  m > 0 && m + halfHeight < innerHeight

      and it is bound solely to scroll/resize/focus, so a unit that is already in
      view when it loads is never assessed at all. Dispatching the event it is
      waiting for is the difference between "their rule said no" and "their rule
      was never asked" — and only the second one is our bug. We never add
      `exo_wrapper_show` ourselves; an ad nobody can see must never report an
      impression.

      Fires once. `once` is latched before the dispatch so a re-entrant
      scroll handler cannot double-fire it.
    */
    let nudged = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (nudged || e.intersectionRatio < 0.1) continue;
          // Their check needs the player in the DOM before it can measure it.
          if (!el.querySelector("video, iframe, img")) continue;
          nudged = true;
          window.dispatchEvent(new Event("scroll"));
          window.dispatchEvent(new Event("resize"));
          io.disconnect();
        }
      },
      { threshold: [0.1, 0.5] },
    );
    io.observe(el);

    void loadProvider(tag.src).then((ok) => {
      if (!ok) {
        // Blocked, or the loader could not be fetched at all.
        observer.disconnect();
        mo.disconnect();
        clearTimeout(emptyTimer);
        clearTimeout(retryTimer);
        // Nothing was ever asked for, so hand the zone back to any other slot.
        releaseClaim();
        fillCb.current?.(false);
        beacon(slot, false);
        return;
      }
      /*
        Tells the loader to re-scan the document and fill every placeholder it
        has not stamped yet — which, after the rebuild above, includes ours.

        COALESCED: `serve` is document-wide, so one push covers every slot that
        mounted this frame. Pushing per instance turned /history's four
        placements into four full ad requests per visit and exhausted the
        per-visitor cap in a couple of navigations. See `requestServe`.
      */
      requestServe(tag.src ?? EXOCLICK_PROVIDER_SRC);
      // Whatever the state is now — the observers keep it current from here.
      report();
    });

    return () => {
      observer.disconnect();
      mo.disconnect();
      // A queued check must not run against a host this cleanup is about to empty.
      if (frame) cancelAnimationFrame(frame);
      io.disconnect();
      // Free the zone for whichever slot mounts next.
      releaseClaim();
      el.removeEventListener("pointerdown", onClick, { capture: true });
      clearTimeout(emptyTimer);
      clearTimeout(retryTimer);
      fillCb.current?.(false);
      /*
        Take the loader's wrapper down with us. It is a foreign node inside a
        host React believes is empty; leaving it behind would stack one dead
        creative per navigation inside a bar that never unmounts.
      */
      el.textContent = "";
    };
    // `serveKey`, NOT `pathname` — a navigation only bumps it when the slot is
    // empty, so this effect's cleanup can never tear down a live creative.
  }, [mounted, ready, showAds, tag, serveKey, slot]);

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
  /*
    🔴 NO SIZE, NO POSITION, NO CSS OF OURS AT ALL (owner, 2026-08-31: "before
    the banner was showing, dont give the banner or interstilla any artificial
    size or position, let them decide everything").

    This host used to carry a flex-centring rule, a `width: 100%`, a `minHeight`
    floor for the outstream slot, and `!important` overrides forcing the injected
    iframe and img to full width. Every one of them was added to fix a symptom,
    and between them they caused:

      • a tall empty gap above the history grid when the box was reserved and
        nothing arrived;
      • a DEADLOCK on the outstream slot, whose player sizes itself to its
        container — so a container we collapsed to earn its height gave the
        player nothing to initialise in, and it could never fill;
      • three rounds of "still not centred", because the rules were being
        applied to a box whose contents we do not control and cannot measure.

    The unit knows its own dimensions and its own placement; the loader has
    `exoDynamicParams` for exactly that and positions its fullpage and sticky
    products itself. Anything we assert here is a guess competing with the
    network's own answer, and the guess kept losing.

    So the host is a bare `<div>` with the `<ins>` inside it and nothing else.
    It is still OUR element — that is what keeps the loader's injected sibling
    contained and torn down with us rather than orphaned among React's children
    (see the header) — but it asserts nothing about the creative.

    ── 🔴 EXCEPT `width: 100%`, WHICH IS THE ABSENCE OF A SIZE, NOT ONE ─────────

    Removing this too was a regression, and it is measurable on PRODUCTION
    (`scripts/exoclick-prod-probe.mjs`, 2026-08-31 — a local run cannot see it,
    because localhost is an unauthorised referer and every zone is declined):

        zone 6016480  host 0x0  display=block | parent display=flex w=412
        processed=true  siblings=1 (DIV)  painted=0

    Read that carefully, because it says the opposite of "the network has
    nothing for us": `processed=true` and a sibling `<div>` mean their loader
    FOUND our placeholder, read our zone id, asked, and inserted its wrapper.
    It then rendered into a box **zero pixels wide**.

    The cause is one line of CSS we do not own. `TopBannerAd`'s inner container
    is `flex`, so this host is a FLEX ITEM; an empty flex item's `flex-basis:
    auto` resolves against its content, and its content is an `<ins>` that is
    empty by design (finding 1 — the creative is a SIBLING). Width 0. A creative
    that sizes to its container then has nothing to size to, which on screen is
    indistinguishable from a no-fill — so "no size at all" became "no ad at
    all", on every page at once.

    A container collapsed to zero is not the absence of an artificial size, it
    is the most restrictive one it is possible to impose. "Let them decide
    everything" means handing the unit the space that exists and letting it
    choose what to occupy — so width is offered, and HEIGHT is still never
    asserted (no `minHeight`, no aspect box), which is the half that was
    actually reserving empty gaps. Nothing here centres, stretches or overrides
    the creative; those `!important` rules stay gone.
  */
  /*
    ── 🔴 AND `maxWidth` + `overflow`, WHICH ARE A FENCE, NOT A SIZE ───────────

    Owner, 2026-09-01: the landing unit "showed once too large below the landing
    page wallpaper button".

    A multi-format zone is a CONTAINER whose creative comes from a child zone,
    so its intrinsic width is whatever the advertiser's unit happens to be —
    600x250 was observed on 6017110. Offered a 100%-wide box narrower than that,
    the creative does not shrink: it overflows, and on a phone that is an ad
    wider than the screen dragging a horizontal scrollbar across the page.

    These two declarations say only "you may not be wider than the space you were
    given". They assert no width, no height and no position, so none of the
    failures recorded above can come back: the box the creative sizes itself
    against is still exactly 100% of the container, which is what the outstream
    player needs to initialise and what the 0px flex-item bug was about.

    `overflow` is on OUR host, deliberately, not on the loader's injected
    wrapper — styling their element is what three rounds of "still not centred"
    got wrong, and a `position: fixed` creative (the sticky and fullpage
    products place themselves) is unaffected by an ancestor's overflow, so this
    cannot clip the products that own their own placement.
  */
  return <div ref={host} style={{ width: "100%", maxWidth: "100%", overflow: "hidden" }} />;
}

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
const providerPromises = new Map<string, Promise<boolean>>();

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
 * Adsterra can both run rather than competing for one slot. All three are the
 * same ExoClick DISPLAY mechanism — an <ins> their loader fills — so they share
 * one component rather than three that drift apart.
 */
export type ExoClickInsSlot = "sticky" | "history" | "bottomnav";

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
function beacon(slot: ExoClickInsSlot, filled: boolean): void {
  try {
    navigator.sendBeacon?.(
      "/api/track",
      new Blob(
        [JSON.stringify({ kind: "banner", slot, filled, path: location.pathname })],
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
  if (host.offsetHeight > 0) return true;

  /*
    A floor, not a pixel test. The scaffolding is 0-sized and tracking pixels are
    1x1; anything a person could actually see clears 20x20 comfortably. Capped so
    a pathological subtree can never make an observer callback expensive — real
    ad markup is a few dozen nodes.
  */
  let seen = 0;
  for (const el of host.querySelectorAll<HTMLElement>("*")) {
    if (++seen > 200) break;
    if (el.tagName === "STYLE" || el.tagName === "SCRIPT" || el.tagName === "INS") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
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
      retried.current = true;
      setServeKey((k) => k + 1);
    }, 3500);
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
    const observer = new ResizeObserver(report);
    observer.observe(el);
    // The wrapper is inserted as a SIBLING of the <ins>, so watch the subtree
    // for it too — a child resizing does not resize the host on every layout.
    const mo = new MutationObserver(report);
    mo.observe(el, { childList: true, subtree: true });

    void loadProvider(tag.src).then((ok) => {
      if (!ok) {
        // Blocked, or the loader could not be fetched at all.
        observer.disconnect();
        mo.disconnect();
        clearTimeout(emptyTimer);
        clearTimeout(retryTimer);
        fillCb.current?.(false);
        beacon(slot, false);
        return;
      }
      try {
        // Tells the loader to re-scan the document and fill every placeholder it
        // has not stamped yet — which, after the rebuild above, is ours.
        (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
      } catch {
        /* A broken provider must never take a page down over a banner. */
      }
      // Whatever the state is now — the observers keep it current from here.
      report();
    });

    return () => {
      observer.disconnect();
      mo.disconnect();
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
  return <div ref={host} style={{ width: "100%" }} />;
}

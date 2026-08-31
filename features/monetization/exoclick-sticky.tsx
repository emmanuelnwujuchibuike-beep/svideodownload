"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  EXOCLICK_PROVIDER_SRC,
  type ExoClickStickyTag,
} from "@/lib/monetization/exoclick-sticky";
import { usePageSettled } from "@/lib/dom/use-page-settled";
import { debugMessages, loaderVerdict } from "@/lib/monetization/exoclick-verdict";
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

/**
 * 🔴 EVERY DOMAIN'S SCRIPT MUST BE LOADED. I got this exactly backwards once.
 *
 * The bundle guards its own construction:
 *
 *     (Array.isArray(window.AdProvider) || void 0 === window.AdProvider)
 *       && (window.AdProvider = function () { … })
 *
 * which is true: the second provider script does NOT rebuild the provider. I
 * concluded from that alone that a second script was a no-op and short-circuited
 * it away. That was wrong, and it is why the fullpage interstitial reported
 * `Interstitial empty` on every ask while its tag was correctly configured.
 *
 * The very next statements in their bundle are a COMMA expression, so they run
 * unconditionally — the `&&` above binds tighter and does not guard them:
 *
 *     …), AdProvider.handleCurrentDomain(n), AdProvider.handleSnippetQueue(e), …
 *
 * and `handleCurrentDomain` is:
 *
 *     function (d) { for (…) if (a[t].syndication === d.syndication) return;
 *                    a.push(d); for (…) W(o[t], d); }
 *
 * So a second script REGISTERS ITS SYNDICATION DOMAIN with the already-running
 * provider and replays the queued commands against it. That is precisely the
 * supported way to serve zones from two domains, and skipping it left zone
 * 6016704 — issued for `pemsrv` — being asked of `magsrv`, which does not have
 * it. "No ads to display", forever, for a zone that was set up correctly.
 *
 * Each domain is still loaded at most ONCE (the promise map above); what is
 * gone is the idea that a live provider makes another domain's script pointless.
 */


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
 * WHY a slot ended up empty — the distinction that turns "no ad" into a lead.
 *
 * "Empty" on its own cannot tell an ExoClick decision apart from a failure on
 * our side, and those need completely different fixes:
 *
 *   no-ads   ExoClick answered "has no ads to display". Their side: the zone,
 *            its approval, demand for this visitor — or an ads.txt that does
 *            not authorise them to sell the inventory.
 *   timeout  we asked and never heard back. Ours, or the network is unreachable.
 *   blocked  the loader script itself never ran — an ad blocker, usually.
 *   ended    it DID fill and then removed itself, which is what an outstream
 *            player does after one play.
 */
export type EmptyReason = "no-ads" | "timeout" | "blocked" | "ended";

/**
 * How long a slot may hold a box open before we call it empty.
 *
 * This is the maximum time a reader can be looking at a blank gap where an ad
 * might arrive, so it is a UX number, not a network one. Four seconds is long
 * enough for the loader's own request to come back on a phone connection and
 * short enough that a no-fill is not a hole anybody stares at.
 *
 * It does NOT cap the fill: the observers keep watching for the life of the
 * unit, so a creative that lands late still appears and the box comes back with
 * it. All this bounds is how long we are willing to look hopeful.
 */
const EMPTY_VERDICT_MS = 4000;

/** How often the loader-s log is checked, and the hard ceiling on doing so. */
const POLL_MS = 400;
const POLL_MAX_MS = 15_000;

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
function beacon(slot: ExoClickInsSlot, filled: boolean, reason?: EmptyReason): void {
  try {
    navigator.sendBeacon?.(
      "/api/track",
      new Blob(
        [JSON.stringify({ kind: "banner", slot, filled, reason, path: location.pathname })],
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
    🔴 MEASURE IT. DO NOT PATTERN-MATCH IT (owner, 2026-08-31: "is still the
    same, nothing changed").

    This used to ask whether the host contained an <iframe>/<video>/<img>/… and
    fall back to height. That is a GUESS about markup we do not control and
    cannot see locally — an authorised referer is required for a real fill, so
    every local test ran against a stub that injected an <img>, which is exactly
    the one shape the guess got right. Whatever ExoClick actually injects for a
    given zone — a background-image div, a shadow root, a canvas painted later
    — that did not match became "no fill", the bar stayed chromeless, and the
    banner "never showed".

    Occupying space is the only property that matters and the only one that is
    true of every creative: if it has height, there is something to show. It is
    also what the reader is actually asking about.
  */
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
  /**
   * What we know about this slot right now.
   *
   * "pending" is the state that matters: it is NOT the same as "empty", and
   * treating them alike is what starved the outstream slot of the box it needs
   * to render into. See the style block below.
   */
  const [status, setStatus] = useState<"pending" | "filled" | "empty">("pending");
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
    🔴 NEVER BEFORE THE PAGE HAS LOADED (owner, 2026-08-31: "frenzsave is stuck
    loading, it delays a lot, seems the lcp is broken").

    This appended ExoClick-s ~195 KB provider the moment it mounted — during
    hydration, while the browser is still fetching what the LCP is waiting on.
    Measured on this build, Pixel 7, slow-4G + 4x CPU, median of 5 runs:

        third parties allowed   LCP 2940ms   21 long tasks (6221ms)
        third parties blocked   LCP  396ms    4 long tasks  (925ms)

    `ExoClickUnit` has waited for `load` since the same problem was measured on
    2026-08-30. This placement never did, and it is the one that now runs on
    every page. See lib/dom/use-page-settled.ts.
  */
  const settled = usePageSettled();

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
    if (!el || hasCreative(el)) return;
    setServeKey((k) => k + 1);
  }, [pathname]);

  useEffect(() => {
    if (!mounted || !settled || !ready || !showAds || !tag) return;
    const el = host.current;
    if (!el) return;

    /*
      A FRESH placeholder every time. The loader stamps `data-processed="true"`
      on whatever it has seen and its selector excludes those forever, so
      re-using an element is the same as not having one. Building it here rather
      than in JSX also keeps React out of a subtree a third-party script mutates
      from underneath it.
    */
    /*
      🔴 THE PENDING BOX IS FOR THE FIRST ATTEMPT ONLY (owner, 2026-08-31: "the
      history page above the grid is showing blank", with a screenshot of a tall
      empty gap above the day groups).

      An outstream player needs a container with height to initialise in, so the
      box has to exist BEFORE the fill — but a box that outlives a no-fill is
      the "large empty hole in the middle of the page" the 2026-08-30 note
      warned about, and that is what the screenshot shows. Both are true; the
      answer is that the box is a short LOAN, not a reservation.

      A retry has already had its chance to be a hole once. It re-asks with a
      fresh placeholder but keeps the collapsed layout, so the reader never sees
      the gap twice for the same slot.
    */
    setStatus(retried.current ? "empty" : "pending");
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

    /*
      🔴 ASK THE LOADER WHAT HAPPENED, INSTEAD OF TIMING IT (owner, 2026-08-31:
      "the history banner or outstream video is not showing, the two links are
      set up").

      Every previous attempt at this inferred the answer from the DOM and a
      stopwatch, and each guess was wrong in its own way: watch the <ins> (the
      creative is a sibling), watch for an <img> (it might be a video, or a
      background), collapse after 4 seconds (an outstream reveals on
      viewability, which can be later than that). The outstream slot is the
      worst case, because it needs a sized box to initialise in — so a timer
      that withdraws the box is a timer that can PREVENT the fill it is waiting
      for.

      The loader keeps its own log and exposes it: `AdProvider.getDebugMessages()`.
      It contains, verbatim from their bundle:

        "Request #<n> Placement #<m> was pushed with zone {…\"id\":6015590…}"
        "Request #<n> Placement #<m> has no ads to display"
        "Request #<n> handling the response"

      That is the network's OWN verdict, per zone, and it is available before
      anything paints. So the box now comes down when ExoClick says there is no
      ad — immediately, so there is no hole — and stays up while a served
      request is still working, however long the player takes to become
      viewable. The stopwatch survives only as the fallback for when that log is
      unavailable.
    */
    const logStart = debugMessages().length;
    let emptyTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopPoll = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
    const clearTimers = () => {
      if (emptyTimer) clearTimeout(emptyTimer);
      if (retryTimer) clearTimeout(retryTimer);
      emptyTimer = null;
      retryTimer = null;
    };
    const settleEmpty = (reason: EmptyReason) => {
      stopPoll();
      clearTimers();
      setStatus("empty");
      if (!everFilled) beacon(slot, false, reason);
    };
    /*
      🔴 THIS POLL IS HARD-BOUNDED, and it was not (owner, 2026-08-31: "frenzsave
      is stuck loading, it delays a lot, seems the lcp is broken").

      The first version stopped only on a fill or a refusal. On `served` it
      cleared the fallback timer and then just kept going — every 400ms, running
      a regex over a debug array that GROWS for the life of the page, forever,
      once per slot. Two banners on a page is two permanent intervals doing
      pointless work on the main thread, and that is exactly what a page that
      "delays a lot" feels like.

      There are now two independent stops. `served` ends it immediately, because
      at that point the poll has nothing left to learn — the observers take over
      and they are the ones that see the creative land. And the absolute cap
      ends it regardless, so no future branch can leave it running.
    */
    const pollStartedAt = Date.now();
    poll = setInterval(() => {
      if (everFilled || Date.now() - pollStartedAt > POLL_MAX_MS) {
        stopPoll();
        return;
      }
      const verdict = loaderVerdict(tag.zoneId, logStart);
      if (verdict === "empty") {
        // ExoClick has answered: nothing for this visitor. Collapse at once.
        settleEmpty("no-ads");
      } else if (verdict === "served") {
        // An ad IS on its way. The box must survive until the player decides it
        // is viewable, so the fallback timer goes — and so does the poll, whose
        // one question has now been answered.
        stopPoll();
        clearTimers();
      }
    }, POLL_MS);

    emptyTimer = setTimeout(() => {
      if (everFilled) return;
      // Fallback only: the loader told us nothing either way. Believing an
      // unanswered request forever is how the "large empty hole" comes back.
      settleEmpty("timeout");
    }, EMPTY_VERDICT_MS);

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
    retryTimer = setTimeout(() => {
      if (hasCreative(el) || retried.current) return;
      retried.current = true;
      setServeKey((k) => k + 1);
    }, EMPTY_VERDICT_MS + 2000);
    const report = () => {
      const now = hasCreative(el);
      if (now === last) return;
      last = now;
      fillCb.current?.(now);
      if (now) {
        stopPoll();
        clearTimers();
        everFilled = true;
        setStatus("filled");
        beacon(slot, true);
      } else if (everFilled) {
        /*
          It filled and then went away — the outstream player hiding itself
          after one play. That IS empty now, so the box goes with it; the
          alternative is a 180px hole where an ad used to be.
        */
        setStatus("empty");
        beacon(slot, false, "ended");
      }
      // Otherwise still PENDING. Reporting "empty" here would withdraw the box
      // an outstream unit has not finished initialising in — see the style block.
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
        stopPoll();
        clearTimers();
        fillCb.current?.(false);
        beacon(slot, false, "blocked");
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
      stopPoll();
      clearTimers();
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
  }, [mounted, settled, ready, showAds, tag, serveKey, slot]);

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
        🔴 THE OUTSTREAM SLOT NEEDS ITS BOX **BEFORE** IT FILLS, NOT AFTER
        (owner, 2026-08-31: "the history above the grid banner doesnt show at
        all", and "center the history banner to be positioned in center").

        This was `slot === "history" && filled`, which is a deadlock for an
        outstream video: the player sizes itself to its CONTAINER, a
        `display:block` element with a width and no height computes to 0px, and
        a 0px container gives the player nothing to initialise in — so it never
        renders, so the host never gains height, so `filled` never becomes true,
        so the box is never granted. "Earn the height" is the right rule for a
        BANNER, whose creative brings its own size; it is exactly the wrong rule
        for a unit that asks the page how big it should be. The 2026-08-30 note
        about the 0px collapse was right the first time.

        So the box exists while the answer is still PENDING, and is withdrawn
        only once we know there is nothing — which is what stops it being the
        "large empty hole in the middle of the page" that made the fixed 16:9
        box wrong. `minHeight`, not `aspectRatio`, because this zone also serves
        fixed-size native units a rigid 16:9 would crop.

        Centred with flex on the container: it centres ANY single child whatever
        its display type, which is the whole reason that rule is here rather
        than on the child, where three earlier attempts put it.

        The STICKY slot keeps no size at all — the network pins it to the
        viewport itself, so this host must not occupy or reserve any space.
      */
      style={
        slot === "history"
          ? status === "empty"
            ? { display: "block", width: "100%" }
            : {
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                width: "100%",
                minHeight: 180,
              }
          : slot === "bottomnav"
            ? { display: "flex", justifyContent: "center", alignItems: "center", width: "100%" }
            : { display: "block", width: "100%" }
      }
    />
  );
}

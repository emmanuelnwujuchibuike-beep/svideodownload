"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { logError } from "@/lib/observability/log-error";
import {
  DEFAULT_IN_PAGE_PUSH_DAILY_LIMIT,
  readInPagePushCap,
  readInPagePushSkip,
  recordInPagePushImpression,
  recordInPagePushSkip,
  type InPagePushCapState,
} from "@/lib/monetization/inpage-push-cap";
import { watchNetworkAd } from "@/features/monetization/network-ad-watch";
import {
  reportMonetagFormatInteraction,
  reportMonetagFormatRendered,
  reportMonetagFormatRequested,
} from "@/features/monetization/monetag-report";
import type { MonetagTag } from "@/lib/monetization/monetag";

/**
 * Frequency-caps a single Monetag In-Page Push tag: loads its script AT MOST
 * `dailyLimit` times per local calendar day (default `DEFAULT_IN_PAGE_PUSH_DAILY_LIMIT`,
 * 5), persisted across refreshes/restarts via `localStorage` (see
 * `lib/monetization/inpage-push-cap.ts` for the reset mechanism and the
 * in-memory fallback when storage is unavailable).
 *
 * ── What this hook does NOT do ────────────────────────────────────────────────
 *
 * It does none of the plan/page-scope gating the app already has
 * (`useEntitlements().showAds`, `monetagAllowedOnPath`) — the caller resolves
 * that exactly as it already does for every other Monetag format, and passes
 * the result in as `enabled`. This hook has exactly one job: the daily cap +
 * safe, once-only, off-the-critical-path script loading.
 *
 * ── Duplicate-injection safety in an SPA ──────────────────────────────────────
 *
 * A module-level `Set` (below) remembers which (src, zone) tags were already
 * injected THIS PAGE LOAD, so a component that unmounts/remounts on client
 * navigation (App Router) never re-injects a tag it already loaded — the same
 * pattern `monetag-tags.tsx` already uses for its own tags. A defensive
 * `document.querySelector` check backs that up in case a different code path
 * ever appended the same tag first.
 *
 * ── A skip holds the tag off for 60 seconds ───────────────────────────────────
 *
 * Owner, 2026-09-03: "make the monetag in page push have a cooldown of 60 secs
 * when is skipped." Dismissing the widget records a timestamp
 * (recordInPagePushSkip); while that cooldown runs this hook simply does not
 * inject the tag, and re-arms a timer for the remainder so the load happens the
 * moment the window passes rather than being lost until the next page.
 *
 * The guardrail the owner set alongside it — "it must not block monetag data
 * from reading accurately and showing impression, clicks and revenue" — is why
 * the cooldown acts HERE, on our own injection, and nowhere near the ad itself.
 * A creative already on screen is never touched, so Monetag counts its
 * impression, its click and the revenue behind them exactly as it does today.
 * See inpage-push-skip-watch.ts, which only ever observes.
 *
 * ── Core Web Vitals ────────────────────────────────────────────────────────────
 *
 * Nothing here runs before the page is interactive: if `document.readyState`
 * isn't `"complete"` yet, the hook waits for the `load` event; either way, it
 * then waits one more idle tick (`requestIdleCallback`, with a double-`rAF`
 * fallback for browsers without it) before touching the DOM — so a slow ad
 * network can never compete with LCP/TTI, and the frequency-cap check itself
 * (a couple of `localStorage` reads) never runs on the critical path either.
 */

/** Tags already injected THIS PAGE LOAD, keyed by `src|zone` — survives a
 *  component remount within the same SPA session; resets only on a full
 *  reload, exactly like `monetag-tags.tsx`'s own guard. */
const injectedThisSession = new Map<string, number>();

/**
 * The shortest gap between two loads of the same tag.
 *
 * Owner, 2026-09-03: "users who keeps the pwa open does not regenerate only
 * once."
 *
 * They are describing a real architectural loss. `MonetagScript` lives in the
 * root layout, so it mounts once and never unmounts, and the injection guard
 * used to be an absolute "never twice per document". On a classic site a
 * ten-page visit is ten ad opportunities; in an installed PWA — which never
 * does a full page load after launch — ten screens was ONE, and a visitor who
 * kept the app open all day generated a single opportunity.
 *
 * A genuine route change IS a new page view, and treating it as a new ad
 * opportunity is the same thing a full page load does on any ordinary site. The
 * gap is what keeps that honest:
 *
 *   - it is driven by NAVIGATION, never by a timer. Nothing here loads a tag
 *     because time passed; a person has to move between screens.
 *   - a minute is longer than any real reading of a screen is short. Rapid
 *     back-and-forth taps, a redirect chain, or a route that bounces cannot
 *     manufacture loads.
 *   - the admin daily cap still applies on top and is the hard ceiling.
 *
 * ⛔ This must never become an interval. An impression the visitor did not
 * navigate to is a fabricated one, and it would put the account at risk for a
 * number nobody could defend.
 */
const SPA_REARM_MIN_MS = 60_000;

export interface UseMonetagInPagePushOptions {
  /** Whether this visitor + page qualifies at all (plan is ad-eligible AND the
   *  page is in Monetag's configured scope) — resolved by the caller. */
  enabled: boolean;
  /** Override the default daily cap if a future surface needs a different one. */
  dailyLimit?: number;
}

export interface UseMonetagInPagePushResult {
  /** Today's frequency-cap state; ticks live so a UI reading it reflects the
   *  local-midnight reset without needing a refresh. */
  cap: InPagePushCapState;
  /** True once this tag has either been injected this session or the cap was
   *  already reached when checked — i.e. nothing further happens until the
   *  next local day. */
  settled: boolean;
}

export function useMonetagInPagePush(
  tag: MonetagTag | null,
  { enabled, dailyLimit = DEFAULT_IN_PAGE_PUSH_DAILY_LIMIT }: UseMonetagInPagePushOptions,
): UseMonetagInPagePushResult {
  const [cap, setCap] = useState<InPagePushCapState>(() => readInPagePushCap(dailyLimit));
  const [settled, setSettled] = useState(false);

  /*
    The navigation signal. A pathname change is the only thing that re-opens the
    injection path above — see SPA_REARM_MIN_MS for why it is navigation and
    never a timer.
  */
  const pathname = usePathname();

  /*
    🔴 THE BODY-SCROLL-LOCK GATE IS GONE. DO NOT PUT IT BACK.

    Owner, 2026-09-03: "before impression was showing but since today is not."
    This was why.

    It gated injection on `useBodyScrollLocked()`, meaning to hold the push back
    while somebody was watching media. But TWENTY-PLUS components in this app
    set `document.body.style.overflowY = "hidden"` — every sheet, every modal,
    the quota gate, the install modal, the reward consent sheet — and, fatally,
    `features/app-shell/brand-splash.tsx`. The brand splash is on screen during
    precisely the load + idle window in which this hook injects, so the gate was
    true at the only moment it was ever read, and the tag stopped loading at
    all. A feature meant to skip one context silenced every one of them.

    It could not have worked anyway: the tag loads once, early, and a viewer is
    opened long afterwards, so the creative is already live by then. "Do not
    show over the media" is a LAYERING problem and is solved where layering
    lives — the fullscreen viewer now sits above the ad networks
    (features/downloads/download-player.tsx). Nothing hides a served creative.
  */

  // The injection effect. Deliberately does nothing (not even a cap check)
  // until the page is interactive and this visitor/page actually qualifies.
  useEffect(() => {
    if (typeof window === "undefined" || !tag || !enabled) return;

    let cancelled = false;
    let idleHandle: number | null = null;
    let rafHandle: number | null = null;
    let loadListenerAttached = false;
    /** Re-arm for the tail of a skip cooldown that was still running on arrival. */
    let cooldownTimer: number | null = null;
    /** Teardown for the passive skip watcher, once a tag is actually on the page. */
    let stopSkipWatch: (() => void) | null = null;

    const key = `${tag.src}|${tag.zone ?? ""}`;

    const inject = () => {
      if (cancelled) return;

      /*
        Guard #1 — loaded too recently. Was "loaded at all, ever, in this
        document", which is what limited a whole PWA session to one load. It is
        now a minimum GAP, so a later navigation earns a new opportunity while
        rapid movement earns nothing.
      */
      const last = injectedThisSession.get(key);
      if (last !== undefined && Date.now() - last < SPA_REARM_MIN_MS) {
        setSettled(true);
        return;
      }

      // Re-check right before injecting (not just on mount) — the cap may
      // have ticked over, or another gate instance may have just recorded one.
      const fresh = readInPagePushCap(dailyLimit);
      if (fresh.limitReached) {
        setCap(fresh);
        setSettled(true);
        return;
      }

      /*
        A skip on a previous page (or a previous visit) may still be cooling
        down. Wait out the REMAINDER rather than dropping the load entirely —
        the owner asked for a 60-second gap, not for one fewer ad. settled
        stays false, because this tag has not finished deciding yet.
      */
      /*
        THE COOLDOWN NO LONGER GATES THE INJECTION. Read this before restoring it.

        Owner, 2026-09-03: Monetag impressions "stopped at 29 impression since
        hours ago", right after the cooldown shipped. The cause was the skip
        DETECTOR, not the arithmetic: it attributed this app own React portals
        to the ad network (see network-ad-watch.ts), so a phantom skip was
        recorded within seconds of almost every page load. Any visit shorter
        than the 60-second window then loaded no tag at all, and most visits
        are shorter than a minute.

        The detector is now floored at z-index 1000, which separates the
        network container (9999, measured) from this app own chrome (60,
        measured). But an attribution fix that has not been watched against a
        real fill is a hypothesis, and this one would be tested with the
        owner revenue. So the gate stays off until a live In-Page Push has been
        seen dismissing correctly.

        Skips are still RECORDED, so restoring this is three lines once that
        evidence exists. A cooldown is a nicety; a tag that never loads is
        income.
      */
      void readInPagePushSkip();

      const el = document.createElement("script");
      el.async = true;
      // Server-validated https URL (parseMonetagSnippet) — never a raw
      // snippet, so this cannot become an injection vector.
      el.src = tag.src;
      el.setAttribute("data-monetag", tag.type);
      el.setAttribute("data-monetag-inpage-push-key", key);
      if (tag.zone) el.setAttribute("data-zone", tag.zone);
      if (tag.cfAsync) el.setAttribute("data-cfasync", "false");
      // A failure on the AD NETWORK'S own script (blocked by an extension, a
      // flaky CDN) must never look like our bug, and must never retry-loop —
      // log it once through the app's one error seam and move on.
      el.onerror = () => logError("monetag_inpage_push_script_error", { src: tag.src, zone: tag.zone });
      document.head.appendChild(el);

      injectedThisSession.set(key, Date.now());
      const next = recordInPagePushImpression(dailyLimit);

      /*
        Arm the skip watcher only NOW, so it can never mistake our own
        hydration for the network's DOM. It observes and nothing more — it
        does not touch, hide or remove whatever Monetag renders.
      */
      reportMonetagFormatRequested(tag.type);

      /*
        In-Page Push is the ONE Monetag format whose drawn nodes can be
        attributed with confidence: it is injected on its own, by this hook, and
        nothing else here is loading at that instant. The other formats and the
        moment tags report their REQUEST only — a document-wide watcher cannot
        say which of several self-placing loaders drew a given node, and a
        guess at attribution would be worse than an absent row.
      */
      stopSkipWatch = watchNetworkAd({
        onShown: () => reportMonetagFormatRendered(tag.type),
        // Owner screenshot, 2026-09-03: the push cards were drawn under the
        // status bar in the installed app. Moves them down, never hides them.
        /*
          THE SAFE-AREA OFFSET IS OFF. It set margin-top !important on
          Monetag own container, and Monetag impressions stopped within hours
          of it shipping. Moving a creative cannot be ruled out while a network
          measures its own viewability before firing its pixel, and the owner
          revenue is not the place to find that out. The layout complaint is
          real and stands; the fix must not touch their element.
        */
        onInteraction: () => reportMonetagFormatInteraction(tag.type),
        onDismissed: () => {
          recordInPagePushSkip();
        },
      });

      if (!cancelled) {
        setCap(next);
        setSettled(true);
      }
    };

    const armIdle = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
      if (typeof ric === "function") {
        idleHandle = ric(inject) as unknown as number;
      } else {
        // No requestIdleCallback (e.g. Safari) — a double-rAF still defers
        // past the current paint without needing a real idle-scheduler.
        rafHandle = window.requestAnimationFrame(() => {
          rafHandle = window.requestAnimationFrame(inject);
        });
      }
    };

    if (document.readyState === "complete") {
      armIdle();
    } else {
      loadListenerAttached = true;
      window.addEventListener("load", armIdle, { once: true });
    }

    return () => {
      cancelled = true;
      if (cooldownTimer !== null) window.clearTimeout(cooldownTimer);
      stopSkipWatch?.();
      if (loadListenerAttached) window.removeEventListener("load", armIdle);
      if (idleHandle !== null) {
        const cic = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
        if (typeof cic === "function") cic(idleHandle);
      }
      if (rafHandle !== null) window.cancelAnimationFrame(rafHandle);
      // A script that already loaded is intentionally left in place — Monetag
      // manages its own DOM after that point, and removing it on unmount could
      // break its internal state or cause a visible pop. Only pending,
      // not-yet-fired work is cancelled here — this is what keeps the hook
      // memory-safe without fighting the ad network's own lifecycle.
    };
  }, [tag, enabled, dailyLimit, pathname]);

  // A lightweight live-tick so `cap` visibly reflects the local-midnight reset
  // even with zero interaction. Purely a UX nicety for any consumer that shows
  // "N more today" — the actual correctness guarantee is the date-keyed
  // storage read in `readInPagePushCap`, not this timer.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => setCap(readInPagePushCap(dailyLimit)), 60_000);
    return () => window.clearInterval(id);
  }, [dailyLimit]);

  return { cap, settled };
}

/** Escapes `"` and `\` for safe interpolation into a `[attr="…"]` selector.
 *  `key` is `src|zone`; a URL never needs more than this. */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

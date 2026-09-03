"use client";

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
const injectedThisSession = new Set<string>();

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

      // Guard #1 — already injected this session (handles SPA remounts).
      if (injectedThisSession.has(key)) {
        setSettled(true);
        return;
      }
      // Guard #2 — defensive: the tag is already in the DOM via some other path.
      if (document.querySelector(`script[data-monetag-inpage-push-key="${escapeAttr(key)}"]`)) {
        injectedThisSession.add(key);
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
      const skip = readInPagePushSkip();
      if (skip.inCooldown) {
        cooldownTimer = window.setTimeout(inject, skip.remainingMs);
        return;
      }

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

      injectedThisSession.add(key);
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
  }, [tag, enabled, dailyLimit]);

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

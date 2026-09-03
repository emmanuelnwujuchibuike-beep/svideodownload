"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { reportMonetagMomentRequested } from "@/features/monetization/monetag-report";
import { MONETAG_MOMENT_EVENTS } from "@/lib/monetization/monetag-events";
import {
  monetagAllowedOnPath,
  type MonetagPlacementId,
  type MonetagPlacementTag,
} from "@/lib/monetization/monetag";

/**
 * Loads a Monetag tag at a chosen MOMENT — the owner's per-moment placements.
 *
 * ── What "placement" means for a self-placing network ─────────────────────────
 *
 * Monetag's formats place themselves; you cannot force a specific creative into a
 * precise instant. So a placement lazily LOADS the assigned Monetag zone's tag
 * when the moment fires — Monetag then shows its ad on its own schedule. Each
 * moment fires at most once per cooldown so a moment that repeats (idle, return,
 * navigation) can't spam.
 *
 * ── The moments ───────────────────────────────────────────────────────────────
 *
 *   interstitial → a client navigation (pathname change)
 *   idle         → a few seconds with no interaction, tab visible
 *   return       → the tab/app becomes visible again after ≥ AWAY_MS away
 *   backswipe    → a back navigation (popstate)
 *   download_complete / rewarded / fetch_result → a window event dispatched by
 *     the existing download-complete and rewarded overlays and by the result
 *     card (the app owns those moments already)
 *
 * 🔴 A MOMENT FIRING IS NOT AN AD APPEARING. Verified on production with
 * scripts/monetag-vignette-moments-probe.mjs: idle, download_complete, rewarded
 * and the navigation interstitial each requested their tag and left a
 * <script data-monetag-moment> in the DOM, and NOTHING rendered. Monetag's
 * vignette loader is navigation-triggered (167 kB, 38 internal references to
 * navigation) — it arms on load and shows on a LATER page transition, so it can
 * never appear at the instant a moment fires. That is the network's design, not
 * a bug here; do not go looking for a missing listener.
 *
 * ── Same gates as every ad ────────────────────────────────────────────────────
 *
 * Nothing loads unless the visitor should see ads (`useEntitlements().showAds`,
 * so Pro/Business never do) and the current page is in Monetag's scope
 * (`monetagAllowedOnPath`). The gate is read through a ref so the event listeners
 * always see the latest plan/path without being torn down and rebuilt.
 *
 * The `src` is a server-validated https URL (parseMonetagSnippet) set on a real
 * script element — never markup — so nothing here can inject anything.
 */

/**
 * Tags already ARMED this page load, keyed by src — see `prearm` below.
 * Module-level so an SPA remount does not load the same loader twice.
 */
const armed = new Set<string>();

const IDLE_MS = 4_000;
const AWAY_MS = 5_000;
/** A given moment won't reload its tag more than once per this window. */
const COOLDOWN_MS = 60_000;
const lastFired = new Map<string, number>();

const DOWNLOAD_COMPLETE_EVENT = MONETAG_MOMENT_EVENTS.download_complete;
const REWARDED_EVENT = MONETAG_MOMENT_EVENTS.rewarded;
const FETCH_RESULT_EVENT = MONETAG_MOMENT_EVENTS.fetch_result;

export function MonetagPlacements({
  placements,
  allPages,
  surfaces,
}: {
  placements: MonetagPlacementTag[];
  allPages: boolean;
  surfaces: string[];
}) {
  const { showAds, ready } = useEntitlements();
  const pathname = usePathname();

  // Event listeners are attached once; they read the live gate through this ref
  // so a plan/path change is respected without re-binding every listener.
  const gate = useRef({ ready, showAds, pathname, allPages, surfaces, placements });
  gate.current = { ready, showAds, pathname, allPages, surfaces, placements };

  const fire = useRef((moment: MonetagPlacementId) => {
    const g = gate.current;
    if (typeof document === "undefined") return;
    if (!g.ready || !g.showAds) return;
    if (!monetagAllowedOnPath(g.pathname ?? "/", { monetagAllPages: g.allPages, monetagSurfaces: g.surfaces })) return;

    const p = g.placements.find((x) => x.moment === moment);
    if (!p) return;

    const last = lastFired.get(moment) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) return;
    lastFired.set(moment, Date.now());

    const el = document.createElement("script");
    el.async = true;
    // Server-validated https URL; a raw snippet never reaches the client.
    el.src = p.src;
    el.setAttribute("data-monetag-moment", moment);
    if (p.zone) el.setAttribute("data-zone", p.zone);
    if (p.cfAsync) el.setAttribute("data-cfasync", "false");
    document.head.appendChild(el);
    reportMonetagMomentRequested(moment);
  });

  /*
    ── ARM THE TAG AT PAGE LOAD, NOT AT THE MOMENT ───────────────────────────

    Owner, 2026-09-03, for the third time: "the download completed doesnt
    trigger the monetag vignette instantly."

    Measured on production (scripts/monetag-vignette-moments-probe.mjs): the
    moments all fire — each requested its tag and left a
    <script data-monetag-moment> in the DOM — and nothing rendered. The loader
    is 167 kB with 38 internal references to navigation: Monetag's vignette ARMS
    on load and shows on a LATER page transition. Injecting it AT the moment is
    therefore one transition too late by construction, every time.

    So the tag is now also loaded once per page, early, which is the only change
    that can make the moment land: by the time a download completes, the vignette
    is already armed and can fire on the next transition instead of starting to
    arm itself then.

    🔴 STRICTLY ADDITIVE. The per-moment injection below is untouched, so nothing
    that fires today stops firing. This only loads tags the owner has ALREADY
    configured as placements — it never introduces a tag, a moment or a surface,
    and it obeys the same plan and page-scope gates as everything else here.

    It cannot be instant, and no arrangement of this code can make it instant.
    That is the format. An ad that must appear AT a moment is the app's own
    interstitial (VAST / ExoClick), not Monetag's vignette.
  */
  useEffect(() => {
    /*
      PRE-ARM DISABLED, 2026-09-03. Owner: "two vignette stack ontop each other
      once when i want to fetch."

      That is this, and it was predictable. Every moment here is configured to
      the SAME tag, so loading it once at page load AND again when a moment
      fires puts two instances of one loader on the page, and two vignettes
      stack. Monetag impressions also flatlined in the same window, and a zone
      whose loader is injected several times per page is exactly the shape
      anti-fraud is built to notice.

      The per-moment injection below is the behaviour that shipped originally
      and is left exactly as it was.
    */
    const PREARM_ENABLED = false;
    if (!PREARM_ENABLED) return;
    if (typeof window === "undefined") return;
    const g = gate.current;
    if (!g.ready || !g.showAds) return;
    if (!monetagAllowedOnPath(g.pathname ?? "/", { monetagAllPages: g.allPages, monetagSurfaces: g.surfaces })) return;
    if (g.placements.length === 0) return;

    let cancelled = false;
    const prearm = () => {
      if (cancelled || typeof document === "undefined") return;
      for (const p of gate.current.placements) {
        if (armed.has(p.src)) continue;
        armed.add(p.src);
        const el = document.createElement("script");
        el.async = true;
        // Server-validated https URL; a raw snippet never reaches the client.
        el.src = p.src;
        el.setAttribute("data-monetag-prearm", p.moment);
        if (p.zone) el.setAttribute("data-zone", p.zone);
        if (p.cfAsync) el.setAttribute("data-cfasync", "false");
        document.head.appendChild(el);
        reportMonetagMomentRequested(p.moment);
      }
    };

    /*
      After load, then an idle tick. The landing's 1.6s budget pays nothing for
      this: nothing here touches the DOM until the page is interactive, which is
      the same discipline useMonetagInPagePush follows.
    */
    let idle: number | null = null;
    const armIdle = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
      if (typeof ric === "function") idle = ric(prearm) as unknown as number;
      else idle = window.setTimeout(prearm, 1);
    };
    if (document.readyState === "complete") armIdle();
    else window.addEventListener("load", armIdle, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", armIdle);
      if (idle !== null) {
        const cic = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
        if (typeof cic === "function") cic(idle);
        else window.clearTimeout(idle);
      }
    };
  }, [ready, showAds, pathname, allPages, surfaces, placements]);

  const has = (moment: MonetagPlacementId) => placements.some((p) => p.moment === moment);
  const hasIdle = has("idle");
  const hasReturn = has("return");
  const hasBackswipe = has("backswipe");
  const hasDownload = has("download_complete");
  const hasRewarded = has("rewarded");
  const hasFetchResult = has("fetch_result");

  /* Event/timer-based moments. Re-bound only when the SET of moments changes. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cleanups: Array<() => void> = [];
    const run = (m: MonetagPlacementId) => fire.current(m);

    if (hasIdle || hasReturn) {
      const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
      const hiddenAt = { t: null as number | null };
      let timer: number | undefined;
      const arm = () => {
        window.clearTimeout(timer);
        if (document.visibilityState !== "visible") return;
        if (hasIdle) timer = window.setTimeout(() => run("idle"), IDLE_MS);
      };
      const onVisibility = () => {
        if (document.visibilityState === "hidden") {
          hiddenAt.t = Date.now();
          window.clearTimeout(timer);
          return;
        }
        const away = hiddenAt.t ? Date.now() - hiddenAt.t : 0;
        hiddenAt.t = null;
        if (hasReturn && away >= AWAY_MS) run("return");
        else arm();
      };
      for (const e of ACTIVITY) window.addEventListener(e, arm, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      arm();
      cleanups.push(() => {
        window.clearTimeout(timer);
        for (const e of ACTIVITY) window.removeEventListener(e, arm);
        document.removeEventListener("visibilitychange", onVisibility);
      });
    }

    if (hasBackswipe) {
      const onPop = () => run("backswipe");
      window.addEventListener("popstate", onPop);
      cleanups.push(() => window.removeEventListener("popstate", onPop));
    }

    if (hasDownload) {
      const onDl = () => run("download_complete");
      window.addEventListener(DOWNLOAD_COMPLETE_EVENT, onDl);
      cleanups.push(() => window.removeEventListener(DOWNLOAD_COMPLETE_EVENT, onDl));
    }

    if (hasRewarded) {
      const onReward = () => run("rewarded");
      window.addEventListener(REWARDED_EVENT, onReward);
      cleanups.push(() => window.removeEventListener(REWARDED_EVENT, onReward));
    }

    if (hasFetchResult) {
      const onFetched = () => run("fetch_result");
      window.addEventListener(FETCH_RESULT_EVENT, onFetched);
      cleanups.push(() => window.removeEventListener(FETCH_RESULT_EVENT, onFetched));
    }

    return () => cleanups.forEach((fn) => fn());
  }, [hasIdle, hasReturn, hasBackswipe, hasDownload, hasRewarded, hasFetchResult]);

  /* The interstitial moment: a client navigation. Skips the first render so it
     doesn't fire on the initial page load. */
  const firstNav = useRef(true);
  useEffect(() => {
    if (firstNav.current) {
      firstNav.current = false;
      return;
    }
    if (has("interstitial")) fire.current("interstitial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}

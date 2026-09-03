"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
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
  });

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

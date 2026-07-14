"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { isCriticalActivityInProgress, onCriticalActivityIdle } from "@/lib/pwa/activity-lock";
import { BAKED_APP_BUILD, fetchServerBuild } from "@/lib/pwa/app-version";

/** Reloads now, or — if a critical section (e.g. an in-flight upload) is
 * open — waits for it to end first. Never skips the reload outright, since
 * that would leave the tab on stale code indefinitely. */
function reloadRespectingCriticalActivity() {
  if (!isCriticalActivityInProgress()) {
    window.location.reload();
    return;
  }
  const unsubscribe = onCriticalActivityIdle(() => {
    unsubscribe();
    window.location.reload();
  });
}

/**
 * Registers the service worker on every visit (idempotent). Two reasons this
 * must NOT wait for "Turn on push":
 *  1. Android Chrome only offers "Install app" / "Add to Home Screen" when a
 *     service worker is registered — without this, the install option never
 *     appears in the menu.
 *  2. An already-registered worker means enabling push later is instant, and
 *     pushes display reliably whether the site is open or closed.
 *
 * It also keeps a long-open tab (the classic "my laptop still shows the old UI"
 * bug) current: browsers only auto-check `sw.js` occasionally, so we actively
 * check on focus / tab-visible / a slow interval, push any waiting worker to
 * activate right away, and reload once when it takes control.
 *
 * The sw.js byte-diff alone is NOT enough for installed PWAs: most deploys
 * don't touch sw.js, so a home-screen app resumed from memory kept running the
 * old bundle forever (new sections like Trending Reels never appeared until
 * the user deleted and re-added the app). The build-stamp check below compares
 * this bundle's baked NEXT_PUBLIC_APP_BUILD against /api/app-version on
 * resume/focus and reloads once per new deploy — the moment the user returns.
 */
const RELOADED_KEY = "frenz-reloaded-for";

let versionCheckInFlight = false;
let lastVersionCheck = 0;

async function reloadIfNewDeploy() {
  // Throttle: resume + focus often fire together; one probe per 30s is plenty.
  if (!BAKED_APP_BUILD || versionCheckInFlight || Date.now() - lastVersionCheck < 30_000) return;
  versionCheckInFlight = true;
  try {
    const build = await fetchServerBuild();
    lastVersionCheck = Date.now();
    // Reload once per new build (the guard breaks reload loops if a CDN ever
    // serves a mixed old/new deployment for a moment). `localStorage`, NOT
    // `sessionStorage` — real bug found 2026-07-14 (owner: "stuck in loading"
    // on the iOS back-gesture, "only happens on the webapp"/installed PWA).
    // iOS terminates a backgrounded standalone PWA's WHOLE process for memory
    // pressure far more aggressively than it does a Safari tab; resuming one
    // (including via the edge-swipe-back gesture, which can force exactly
    // this kind of relaunch) is a genuine COLD START — a brand-new JS
    // context with a brand-new sessionStorage, since sessionStorage is
    // scoped to that now-dead process/tab session. With deploys landing
    // every few minutes during active development, `BAKED_APP_BUILD` was
    // stale on nearly every cold start, so this guard — reset every single
    // time by sessionStorage's amnesia — never actually remembered "already
    // reloaded for this build," and every resume reloaded again, which looks
    // exactly like "stuck in loading" (a perpetual reload, not a hang) and
    // explains why it was PWA-only: a plain browser tab is not torn down and
    // relaunched anywhere near this often. `localStorage` is disk-backed per
    // origin and survives a process kill+relaunch, so this now actually
    // remembers across a real cold start, while still correctly reloading
    // again the moment a genuinely newer build is deployed.
    if (build && build !== BAKED_APP_BUILD && localStorage.getItem(RELOADED_KEY) !== build) {
      localStorage.setItem(RELOADED_KEY, build);
      reloadRespectingCriticalActivity();
    }
  } catch {
    /* localStorage unavailable (private browsing, quota) — try again next resume */
  } finally {
    versionCheckInFlight = false;
  }
}

export function RegisterServiceWorker() {
  const router = useRouter();

  // Tapping a notification with the app already open hands the destination
  // URL back here (public/sw/push.js's notificationclick handler) instead of
  // the service worker forcing a hard `client.navigate()` — that API is
  // unreliable on iOS Safari/WKWebView and could leave the tab stuck
  // mid-navigation. A normal client-side router push is the same fast,
  // robust path a Link click already takes.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "frenz-navigate" && typeof event.data.url === "string") {
        router.push(event.data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | null = null;
    // Only reload for an UPDATE (a worker replacing an existing one) — never on
    // the very first install (there's no stale UI to replace then).
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;

    // Tell a worker that has finished installing to activate immediately instead
    // of waiting for every tab to close.
    const promote = (r: ServiceWorkerRegistration) => {
      if (r.waiting) r.waiting.postMessage("SKIP_WAITING");
    };

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((r) => {
        reg = r;
        r.update().catch(() => {});
        promote(r);
        // A new version was found while a tab is open → promote it once installed.
        r.addEventListener("updatefound", () => {
          const installing = r.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) promote(r);
          });
        });
      })
      .catch(() => {});

    const onControllerChange = () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      reloadRespectingCriticalActivity();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Actively re-check for a new deploy — the piece that fixes an always-open
    // laptop tab that never navigates, and a resumed home-screen app.
    const check = () => {
      reg?.update().catch(() => {});
      void reloadIfNewDeploy();
    };

    // A version-check that finds a new build reloads the WHOLE page (full
    // cold boot — boot splash + every route's loading.tsx) — correct for a
    // real return from being away, but during active development a new
    // deploy can land every few minutes, so gating this on visibility/focus
    // alone reloaded on almost every brief app-switch too (owner: "Home
    // seems to always load and delay ... when I minimize and come back
    // within a minute"). Only run the check if the tab was actually hidden
    // for a real stretch of time — a quick alt-tab or a few seconds in
    // another app skips it entirely; the 60s interval below still catches a
    // long-open tab that's never backgrounded.
    const MIN_AWAY_MS = 60_000;
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt < MIN_AWAY_MS) return;
      check();
    };
    const onFocus = () => {
      if (hiddenAt && Date.now() - hiddenAt < MIN_AWAY_MS) return;
      check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(check, 60_000);
    // First check shortly after startup (off the critical path).
    const initial = window.setTimeout(() => void reloadIfNewDeploy(), 4_000);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      window.clearTimeout(initial);
    };
  }, []);
  return null;
}

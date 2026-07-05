"use client";

import { useEffect } from "react";

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
 */
export function RegisterServiceWorker() {
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
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Actively re-check for a new deploy — the piece that fixes an always-open
    // laptop tab that never navigates.
    const check = () => reg?.update().catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const interval = window.setInterval(check, 60_000);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.clearInterval(interval);
    };
  }, []);
  return null;
}

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
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // `updateViaCache: none` = never take the SW script from the HTTP cache when
    // checking for updates, so a new deploy is always detected.
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});

    // When a NEW worker takes control (a fresh deploy on an already-open client),
    // reload once so the page picks up the latest assets — fixes the "stale
    // laptop still shows the old UI" bug. We only reload for updates, never on the
    // very first install.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const onChange = () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }, []);
  return null;
}

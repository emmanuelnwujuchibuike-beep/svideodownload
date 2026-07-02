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
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}

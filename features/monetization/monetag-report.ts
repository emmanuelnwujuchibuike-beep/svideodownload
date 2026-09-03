"use client";

/**
 * Beacons Monetag activity to `/api/track`, so every format and moment appears
 * in the admin dashboard's impression, click and live-activity sections.
 *
 * Owner, 2026-09-03: "make all monetag ad slot and format shows the impression,
 * click and interaction sections in the admin dashboard."
 *
 * ── Three honest signals, and the reason there is no fourth ───────────────────
 *
 * See `lib/monetization/monetag-track.ts` for the full reasoning. In short: a
 * self-placing loader draws into its own, usually cross-origin, frame, so the
 * only things this page can witness are that we asked, that something was
 * drawn, and that a pointer landed on it. Everything billed remains Monetag's
 * own number.
 *
 * ── `sendBeacon`, and why the failure mode matters ────────────────────────────
 *
 * `navigator.sendBeacon` survives the page being torn down — an ad interaction
 * very often IS the page being torn down, so a `fetch` here would lose exactly
 * the events worth having. It also returns no response, which is precisely why
 * `/api/track` derives its Monetag slot list from the registries instead of a
 * hand-written copy: a rejected slot would look identical to a recorded one.
 */

import { monetagFormatSlot, monetagMomentSlot } from "@/lib/monetization/monetag-track";
import type { MonetagAdType, MonetagPlacementId } from "@/lib/monetization/monetag";

type Beacon = { slot: string; filled: boolean; click?: boolean };

function send(body: Beacon): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({
    kind: "banner",
    ...body,
    path: location.pathname.slice(0, 120),
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
      return;
    }
    // No sendBeacon (older Safari): keepalive fetch is the closest equivalent.
    void fetch("/api/track", {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* Reporting must never be able to break an ad, or a page. */
  }
}

/** We injected a format's loader. Activity, deliberately NOT an impression. */
export function reportMonetagFormatRequested(type: MonetagAdType | string): void {
  send({ slot: monetagFormatSlot(type), filled: false });
}

/** The network drew something for this format — the observed impression. */
export function reportMonetagFormatRendered(type: MonetagAdType | string): void {
  send({ slot: monetagFormatSlot(type), filled: true });
}

/** A pointer landed on something this format drew. A LOWER BOUND — see above. */
export function reportMonetagFormatInteraction(type: MonetagAdType | string): void {
  send({ slot: monetagFormatSlot(type), filled: true, click: true });
}

/** A moment fired and we injected its tag. Activity, not an impression. */
export function reportMonetagMomentRequested(moment: MonetagPlacementId | string): void {
  send({ slot: monetagMomentSlot(moment), filled: false });
}

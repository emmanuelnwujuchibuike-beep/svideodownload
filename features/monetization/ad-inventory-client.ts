"use client";

import { inventoryBucket, parseAdInventory, type AdInventory } from "@/lib/monetization/ad-inventory-shape";

/**
 * The browser's copy of the ad inventory — ONE request per document, shared by
 * every ad surface (see lib/monetization/ad-inventory-shape.ts).
 *
 * Fails OPEN: a network error, a non-200, or a malformed body resolves to
 * `null`, and every helper treats `null` as "ask the real endpoint", which is
 * exactly the behaviour before this existed. The inventory may only ever SAVE
 * a request; it must never cost an impression.
 *
 * No timer, no retry, no polling: a later bucket is picked up by the next page
 * load, which is soon enough for an admin switch and costs nothing between.
 */
let pending: Promise<AdInventory | null> | null = null;
let resolved: AdInventory | null = null;

export function loadAdInventory(): Promise<AdInventory | null> {
  pending ??= fetch(`/api/ads/inventory?b=${inventoryBucket()}`)
    .then((r) => (r.ok ? r.json() : null))
    .then(parseAdInventory)
    .then((inv) => (resolved = inv))
    .catch(() => null);
  return pending;
}

/** The inventory already in hand, without a request (null = not loaded, or unknown). */
export function peekAdInventory(): AdInventory | null {
  return resolved;
}

/** Tests only. */
export function __resetAdInventory(): void {
  pending = null;
  resolved = null;
}

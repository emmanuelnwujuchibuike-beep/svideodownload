/**
 * The ad INVENTORY — what the site could serve right now, if anything — and the
 * pure helpers the browser uses to decide whether an ad request is worth making.
 *
 * Owner, 2026-10-05: "ads are not running now so they shouldn't request any
 * API, only the one that may run in the future can request when ads are there."
 *
 * Measured on a production build that day, with every network off: one idle
 * page view still made ~7 ad calls (`/api/ads?zones=`, `?zone=global&all=1`,
 * `/api/ads/exoclick` ×2, `/api/monetag`, `/api/ads/config`), each a private,
 * uncacheable function invocation answering `null`. The inventory is ONE
 * global answer, CDN-cached, so the client can skip every one of those when
 * nothing could fill.
 *
 * Pure and dependency-free: imported by client code, so nothing server-side
 * may reach it.
 */

import { CDN_BUCKET_MS, cdnBucket } from "@/lib/net/cdn-bucket";

export interface AdInventory {
  v: 1;
  /** Zones for which /api/ads would answer a free visitor with a slot. */
  slots: string[];
  /** Zones for which /api/ads/exoclick would START a VAST chain. */
  vast: string[];
  /** Whether `?zone=global&all=1` has any page-level script to inject. */
  global: boolean;
  /** Whether Monetag has any tag or placement configured. */
  monetag: boolean;
}

/**
 * The CDN window. The client asks for `?b=<bucket>`, so a fresh URL every five
 * minutes: no browser or Cloudflare TTL rewrite can hold an old answer longer
 * than one bucket — the "admin switch took two hours" bug of 2026-09-03 (see
 * app/api/ads/config) cannot come back through this endpoint.
 */
export const AD_INVENTORY_BUCKET_MS = CDN_BUCKET_MS;

export function inventoryBucket(now: number = Date.now()): number {
  return cdnBucket(now);
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

/**
 * Validate a payload. Anything malformed is `null`, and `null` means UNKNOWN —
 * every caller then requests exactly as it did before this existed. The gate
 * may only ever SAVE a request; it must never cost an impression.
 */
export function parseAdInventory(raw: unknown): AdInventory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slots = stringList(r.slots);
  const vast = stringList(r.vast);
  if (r.v !== 1 || !slots || !vast || typeof r.global !== "boolean" || typeof r.monetag !== "boolean") return null;
  return { v: 1, slots, vast, global: r.global, monetag: r.monetag };
}

/** Should the client ask /api/ads for this zone? Unknown inventory ⇒ yes. */
export function mayServeSlot(inv: AdInventory | null, zone: string): boolean {
  return inv === null || inv.slots.includes(zone);
}

/** Should the client ask /api/ads/exoclick for this zone? Unknown ⇒ yes. */
export function mayServeVast(inv: AdInventory | null, zone: string): boolean {
  return inv === null || inv.vast.includes(zone);
}

/** Is ANY VAST moment possible at all? Unknown ⇒ yes. */
export function anyVast(inv: AdInventory | null): boolean {
  return inv === null || inv.vast.length > 0;
}

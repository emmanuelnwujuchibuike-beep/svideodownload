"use client";

import { loadAdInventory } from "@/features/monetization/ad-inventory-client";
import { mayServeSelf } from "@/lib/monetization/ad-inventory-shape";
import { cdnBucket } from "@/lib/net/cdn-bucket";
import { parseServingPayload, type ServingPayload } from "@/lib/ads-platform/serving-payload";

/**
 * The browser's copy of the self-serve serving payload.
 *
 * Request budget, by construction:
 *   · no live campaign anywhere      → 0 requests (the inventory, which every
 *                                      page already loads, says `self: false`)
 *   · campaigns live                 → 1 CDN-cached request per 5-minute
 *                                      bucket per TAB, shared by every
 *                                      placement on every page — moving between
 *                                      Download, Feed, Reels, AI and Stories
 *                                      re-uses it (memory, then sessionStorage
 *                                      across a reload)
 *   · rotation, no-repeat, targeting → 0 (lib/ads-platform/rotation.ts and
 *                                      adsForPage run on this copy)
 *
 * No timer, no polling, no Realtime: a newer bucket is fetched only when a
 * placement next ASKS after the bucket turned over.
 *
 * Fails EMPTY: any error is `null`, and a placement with `null` renders nothing.
 */

const STORE_KEY = "frenz.ads.self.v1";

let memo: { b: number; p: Promise<ServingPayload | null> } | null = null;

function readStored(b: number): ServingPayload | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    const parsed = raw ? parseServingPayload(JSON.parse(raw)) : null;
    return parsed && parsed.b === b ? parsed : null;
  } catch {
    return null;
  }
}

function store(p: ServingPayload): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota — the in-memory copy still serves this document */
  }
}

export function loadSelfAds(now: number = Date.now()): Promise<ServingPayload | null> {
  const b = cdnBucket(now);
  if (memo?.b === b) return memo.p;
  const stored = readStored(b);
  const p = stored
    ? Promise.resolve(stored)
    : loadAdInventory().then((inv) =>
        !mayServeSelf(inv)
          ? null
          : fetch(`/api/ads/self?b=${b}`)
              .then((r) => (r.ok ? r.json() : null))
              .then(parseServingPayload)
              .then((payload) => {
                if (payload) store(payload);
                return payload;
              }),
      ).catch(() => null);
  memo = { b, p };
  return p;
}

/** Tests only. */
export function __resetSelfAds(): void {
  memo = null;
}

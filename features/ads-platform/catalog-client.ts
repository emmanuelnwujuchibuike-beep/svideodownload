"use client";

import { parseCatalog, type AdCatalog } from "@/lib/ads-platform/offer";

/**
 * The advertiser's menu, read ONCE per visit straight from Postgres
 * (`rpc/ad_catalog`, 0196) with the public key — no Vercel function, no
 * Railway, no Realtime. Cached in memory and in sessionStorage for five
 * minutes, so moving between the steps, reloading or opening the rules and
 * coming back costs nothing.
 *
 * Five minutes is safe for a menu because nothing here is final: the server
 * re-checks every choice at each checkpoint and the database locks the price.
 * A promotion that ends while the page is open stops being offered at once —
 * `bestPromotion` re-checks `ends_at` against the clock on every render.
 */

const KEY = "frenz.ads.catalog.v1";
const TTL_MS = 5 * 60_000;
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let memo: { at: number; p: Promise<AdCatalog | null> } | null = null;

function stored(now: number): AdCatalog | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw) as { at: number; data: unknown };
    return now - at < TTL_MS ? parseCatalog(data) : null;
  } catch {
    return null;
  }
}

export function loadAdCatalog(now: number = Date.now(), { fresh = false } = {}): Promise<AdCatalog | null> {
  if (!fresh && memo && now - memo.at < TTL_MS) return memo.p;
  const cached = fresh ? null : stored(now);
  const p = cached
    ? Promise.resolve(cached)
    : !URL_BASE || !ANON
      ? Promise.resolve(null)
      : fetch(`${URL_BASE}/rest/v1/rpc/ad_catalog`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
          body: "{}",
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((raw: unknown) => {
            const cat = parseCatalog(raw);
            if (cat) {
              try {
                sessionStorage.setItem(KEY, JSON.stringify({ at: now, data: raw }));
              } catch {
                /* private mode — the memory copy still serves this visit */
              }
            }
            return cat;
          })
          .catch(() => null);
  memo = { at: now, p };
  return p;
}

/** Tests only. */
export function __resetAdCatalog(): void {
  memo = null;
}

"use client";

import { useEffect, useState } from "react";

import { loadAdInventory } from "@/features/monetization/ad-inventory-client";
import { useShowAds } from "@/features/monetization/use-show-ads";
import type { AdPageContext } from "@/lib/ads-platform/catalog";
import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";
import { mayServeSelf } from "@/lib/monetization/ad-inventory-shape";

export type PoolState =
  | { status: "pending" }
  | {
      status: "ready";
      ads: EligibleAd[];
      rules: FormatRules | null;
      /**
       * For one-at-a-time placements (a Story card): the next ad that may show
       * NOW — never the one shown last, within the format's admin gap — and it
       * is recorded as shown. Null when nothing may show.
       */
      take: () => EligibleAd | null;
    };

const none = (): EligibleAd | null => null;
const NONE: PoolState = { status: "ready", ads: [], rules: null, take: none };

/**
 * One paid-only placement's pool (Stories): no network unit shares it.
 *
 * Imports only the shared inventory check; the engine (`paid-runtime`) is a
 * dynamic import fetched only when the inventory says a paid campaign is live,
 * so a page with no campaign downloads none of it. Mounting, re-rendering and
 * Strict Mode are not requests: the payload is memoised per 5-minute bucket.
 * Ad-free members get an empty pool at once. Fails EMPTY.
 */
export function useSelfAdPool(placement: string, page: AdPageContext | null): PoolState {
  const { showAds, ready } = useShowAds();
  const [state, setState] = useState<PoolState>({ status: "pending" });

  useEffect(() => {
    if (!ready) return;
    if (!showAds) {
      setState(NONE);
      return;
    }
    let alive = true;
    let off: (() => void) | null = null;
    const compute = async () => {
      const inv = await loadAdInventory();
      if (!mayServeSelf(inv)) {
        if (alive) setState(NONE);
        return;
      }
      const rt = await import("./paid-runtime");
      const pool = rt.poolFor(await rt.loadSelfAds(), placement, page);
      off ??= rt.onCreativeFailed(() => void compute().catch(() => {}));
      if (!alive) return;
      const take = () => {
        if (!pool.ads.length || !rt.mayShowAgain(placement, pool.rules)) return null;
        const ad = rt.nextFromPool(placement, pool.ads);
        if (ad) rt.recordShown(placement, ad.cr);
        return ad;
      };
      setState({ status: "ready", ads: pool.ads, rules: pool.rules, take });
    };
    compute().catch(() => {
      if (alive) setState(NONE);
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [ready, showAds, placement, page]);

  return state;
}

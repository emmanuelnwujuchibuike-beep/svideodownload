"use client";

import { useEffect, useState } from "react";

import { useShowAds } from "@/features/monetization/use-show-ads";
import type { AdPageContext } from "@/lib/ads-platform/catalog";
import { onCreativeFailed, poolFor, type Pool } from "@/lib/ads-platform/serving-state";

import { loadSelfAds } from "../serving-client";

export type PoolState = { status: "pending" } | ({ status: "ready" } & Pool);

const PENDING: PoolState = { status: "pending" };
const NONE: PoolState = { status: "ready", ads: [], rules: null };

/**
 * One placement's pool of paid campaigns, for a renderer.
 *
 * Request budget is the serving client's, not this hook's: every placement on
 * every page shares ONE cached payload per 5-minute bucket, and with no live
 * campaign the shared ad inventory says so and nothing is requested at all.
 * Mounting, re-rendering, Strict Mode's double effect, a tab change — none of
 * them is a request; `loadSelfAds` answers from memory.
 *
 * `pending` until the answer is known, so a call site that also has a NETWORK
 * fallback can wait for it instead of asking both. That wait costs nothing
 * extra: the self check rides the same inventory promise the network slot
 * awaits anyway.
 *
 * Ad-free members (Pro/Business) are `ready` and empty at once — no fetch.
 * Fails EMPTY: any error is an empty pool, never a broken surface.
 */
export function useSelfAdPool(placement: string, page: AdPageContext | null, opts: { enabled?: boolean } = {}): PoolState {
  const { showAds, ready } = useShowAds();
  const enabled = opts.enabled ?? true;
  const [state, setState] = useState<PoolState>(PENDING);

  useEffect(() => {
    if (!ready) return;
    if (!showAds || !enabled) {
      setState(NONE);
      return;
    }
    let alive = true;
    const compute = () =>
      void loadSelfAds()
        .then((payload) => {
          if (alive) setState({ status: "ready", ...poolFor(payload, placement, page) });
        })
        .catch(() => {
          if (alive) setState(NONE);
        });
    compute();
    // a creative that fails anywhere this session leaves every pool at once
    const off = onCreativeFailed(compute);
    return () => {
      alive = false;
      off();
    };
  }, [ready, showAds, enabled, placement, page]);

  return state;
}

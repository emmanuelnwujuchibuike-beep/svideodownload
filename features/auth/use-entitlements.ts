"use client";

import { useEffect, useState } from "react";

import type { BillingPlan } from "@/lib/monetization/types";

/**
 * Single source of the current visitor's plan/entitlements on the client.
 * Fetches `/api/me` once and memoises it process-wide so badges, premium UI and
 * gating don't each hit the endpoint. Optimistic default: free, not premium.
 */
export interface Entitlements {
  plan: BillingPlan;
  isPremium: boolean;
  isBusiness: boolean;
  showAds: boolean;
  ready: boolean;
}

const FREE: Omit<Entitlements, "ready"> = {
  plan: "free",
  isPremium: false,
  isBusiness: false,
  showAds: true,
};

let cache: Omit<Entitlements, "ready"> | null = null;
let inflight: Promise<void> | null = null;

export function useEntitlements(): Entitlements {
  const [value, setValue] = useState<Omit<Entitlements, "ready">>(cache ?? FREE);
  const [ready, setReady] = useState<boolean>(cache !== null);

  useEffect(() => {
    if (cache !== null) {
      setValue(cache);
      setReady(true);
      return;
    }
    let alive = true;
    inflight ??= fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const plan = (d?.plan as BillingPlan) ?? "free";
        cache = {
          plan,
          isPremium: plan !== "free",
          isBusiness: plan === "business",
          showAds: d?.showAds ?? true,
        };
      })
      .catch(() => {
        cache = FREE;
      })
      .finally(() => {
        inflight = null;
      });

    void inflight.then(() => {
      if (alive && cache) {
        setValue(cache);
        setReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return { ...value, ready };
}

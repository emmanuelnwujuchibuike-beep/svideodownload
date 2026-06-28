"use client";

import { useEntitlements } from "@/features/auth/use-entitlements";

/**
 * Whether to show ads to the current visitor (false for Pro/Business).
 * Thin wrapper over `useEntitlements` so the whole app shares ONE cached
 * `/api/me` fetch (plan, ads, handle) instead of each hook fetching separately.
 */
export function useShowAds() {
  const { showAds, ready } = useEntitlements();
  return { showAds, ready };
}

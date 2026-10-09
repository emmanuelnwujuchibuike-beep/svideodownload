"use client";

import { useSyncExternalStore } from "react";

import type { EligibleAd } from "@/lib/ads-platform/eligibility";

import { trackAdEvent, type AdView } from "../ad-events-client";

/**
 * Tapping a paid ad opens its details ON THE SAME PAGE (owner, 2026-10-09: "make
 * users who click on an ad see the ad review instantly in the same page, and users
 * can choose to visit the link and be warned it is an external link. Users who
 * review the ad details should be recorded in the advertiser's dashboard as
 * conversion and clicks").
 *
 * A tiny module store, so every ad surface can open the one sheet without
 * prop-drilling. Opening sends `click` + `conversion` for that ad view. The
 * client sends each type once per view, so tapping the same ad again does not
 * count again. The sheet's code loads only when it first opens (AdDetailHost).
 */
export interface AdDetailState {
  ad: EligibleAd;
  view: AdView | null;
}

let current: AdDetailState | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export function openAdDetail(ad: EligibleAd, view: AdView | null): void {
  if (view) {
    trackAdEvent(view, "click");
    trackAdEvent(view, "conversion");
  }
  current = { ad, view };
  emit();
}

export function closeAdDetail(): void {
  current = null;
  emit();
}

export function useAdDetail(): AdDetailState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}

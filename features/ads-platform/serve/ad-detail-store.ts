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

/**
 * Open the ad's link NOW, in this tap, as a Snapchat ad does (owner, 2026-10-15:
 * "when a user click on the visit button it opens the link directly instantly like
 * Snapchat ad, it shouldn't show preview or confirmation … any touch around the ad
 * card should open the link instantly"). Replaces the details sheet and the
 * external-link warning on every ad surface.
 *
 * Counted as `click` and `outbound` (a site visit) for the advertiser's
 * dashboard. `window.open` runs synchronously inside the tap, so no browser
 * treats it as a popup. The link is the server-validated destination.
 */
export function visitAd(ad: EligibleAd, view: AdView | null): void {
  if (view) {
    trackAdEvent(view, "click");
    trackAdEvent(view, "outbound");
  }
  const w = window.open(ad.url, "_blank", "noopener,noreferrer");
  // a blocked window.open returns null in some in-app browsers: go there in this tab instead
  if (!w) window.location.assign(ad.url);
}

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
  openAdInNewTab(ad.url);
}

/**
 * Owner, 2026-10-16: "opening ad link shouldn't close the frenzsave tab, it should open another
 * tab so users can still return where they stop".
 *
 * 🔴 The old code was `const w = window.open(url, "_blank", "noopener,noreferrer"); if (!w)
 * location.assign(url)`. With "noopener", window.open ALWAYS returns null (HTML spec) — even when
 * the new tab opened — so the "blocked" fallback ran every time and took the Frenzsave tab to the
 * advertiser's site too. A real link with target=_blank, clicked inside the same tap, opens a new
 * tab (an installed app hands it to the browser) and never navigates this one. If a browser
 * refuses it, nothing happens here: the visitor stays where they were.
 */
export function openAdInNewTab(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer sponsored";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

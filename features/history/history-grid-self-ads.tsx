"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { useSlotProvider, type SlotState } from "@/features/ads-platform/serve/use-slot-provider";

const SelfAdBanner = dynamic(() => import("@/features/ads-platform/serve/self-ad-banner").then((m) => m.SelfAdBanner), { ssr: false });

/**
 * A paid ad tile INSIDE the History grid (owner, 2026-10-09: "Add an ad slot in
 * the history grid, that stays like a history post with the same grid size …
 * one in every 4 square grid").
 *
 * Three downloads, then one ad: the ad is the 4th, 8th, 12th… square of each
 * section, a grid cell like any other, so the grid's columns and gaps never
 * change. Slot `history_grid`, placement `history_grid` (migration 0207) — an
 * advertiser picks it in /advertise once an admin has priced it.
 *
 * 🔴 Paid only, and nothing without a live campaign: no empty square, no
 * placeholder, no "Advertise here". Until a campaign is live the grid is
 * exactly the grid it was. The tile's media is fetched only then.
 */
export const HISTORY_GRID_AD_EVERY = 4;

export function useHistoryGridAds(): SlotState {
  return useSlotProvider("history_grid", "history").state;
}

/**
 * The tiles with an ad after every 3 of them. `tiles` are already-rendered
 * GalleryTiles; `ads` is the slot state from `useHistoryGridAds` (called once
 * per gallery, so every section shares one resolve). `section` keeps keys
 * unique and offsets the rotation so neighbouring ad tiles differ.
 */
export function withGridAds(tiles: readonly ReactNode[], ads: SlotState, section = 0): ReactNode[] {
  if (ads.status !== "ready" || ads.provider !== "frenzsave" || ads.ads.length === 0) return [...tiles];
  const out: ReactNode[] = [];
  let n = 0;
  tiles.forEach((tile, i) => {
    out.push(tile);
    if ((i + 1) % (HISTORY_GRID_AD_EVERY - 1) === 0) {
      out.push(
        <div key={`history-grid-ad-${section}-${n}`} data-ad-slot="history_grid" data-ad-provider="frenzsave">
          <SelfAdBanner ads={ads.ads} rules={ads.rules} placement="history_grid" page="history" variant="tile" startAt={section + n} />
        </div>,
      );
      n++;
    }
  });
  return out;
}

/**
 * The static landing's ad runtime (owner, 2026-10-28: "make sure nothing blocks the Adsterra scripts, the pop-under and
 * the Smartlink"). The landing runs no React, so it used to carry hand-written copies of a few ad rules — and missed
 * three: the spot pop-under, the Monetag Direct Link / Adsterra Smartlink at the download spots, and the site-wide
 * Adsterra scripts (social bar, multitag…). Its HilltopAds guard also replaced window.open for good, which blocked every
 * pop-under and link our own taps were meant to open.
 *
 * This is NOT a copy: it re-exports the app's own modules, bundled to public/landing/ads.js by
 * scripts/build-landing-ads.mjs, so the landing and the app share one rule set (popunder-guard's short allow window,
 * open-observer's one-ad-per-tap gate, the spot cooldown, each link's own chance).
 */
import type { DirectLinkSpot } from "@/lib/monetization/direct-link";
import { installPopunderGuard } from "@/lib/monetization/popunder-guard";

import { loadAdInventory } from "./ad-inventory-client";
import { loadDirectLinkOpener, type SpotOpener } from "./direct-link-runtime";
import { injectAdMarkup } from "./inject";

const openers: Partial<Record<DirectLinkSpot, SpotOpener | null>> = {};

/** Ready the openers for these spots (preconnects, and the pop-under tag once a spot is on screen). Fails quietly. */
export async function armSpots(spots: DirectLinkSpot[]): Promise<void> {
  await Promise.all(
    spots.map(async (s) => {
      if (s in openers) return;
      openers[s] = null;
      openers[s] = await loadDirectLinkOpener(s).catch(() => null);
    }),
  );
}

/** Call INSIDE the tap, before anything awaits: the pop-under, else the Direct Link / Smartlink (one ad per tap). */
export function openSpot(spot: DirectLinkSpot): boolean {
  const open = openers[spot];
  return open ? open() : false;
}

/** The admin's site-wide scripts (zone `global`) — the same request and injection as features/monetization/ad-scripts.tsx. */
export async function globalScripts(): Promise<void> {
  try {
    const inv = await loadAdInventory();
    if (inv && !inv.global) return;
    const r = await fetch("/api/ads?zone=global&all=1");
    const d = (r.ok ? await r.json() : { ads: [] }) as { ads?: { scriptCode?: string | null }[] };
    for (const ad of d.ads ?? []) if (ad.scriptCode) injectAdMarkup(document.body, ad.scriptCode);
  } catch {
    // an ad never breaks the page
  }
}

export { installPopunderGuard };

"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_HILLTOP,
  isHilltopPlacementOn,
  type HilltopConfig,
} from "@/lib/monetization/hilltop-config";

/**
 * Which posts are followed by a HilltopAds in-feed banner.
 *
 * Owner's brief §3B: "1 HilltopAds feed ad every 8-12 organic feed items … Make
 * this configurable rather than hard-coded."
 *
 * ── Its OWN cadence, and why it is not the existing one ───────────────────────
 *
 * 🔴 `FEED_AD_INTERVAL` and `insertAdSlots` are NOT touched. That function is
 * shared with the Reels deck, is covered by its own tests, and drives the
 * `feed_inline` zone that AdSense and Adsterra already serve. Changing a
 * working placement's rhythm — or its keys — to make room for a new network is
 * exactly what the brief's first rule prohibits, and re-keying it would
 * reinitialise every visible ad in the feed.
 *
 * So Hilltop counts POSTS itself and returns the ids it wants to follow. The
 * existing slots keep their positions and their identities; the two cadences
 * are independent, and a reader can see both, neither, or one.
 *
 * ── Anchored to a post id, never to an index ──────────────────────────────────
 *
 * The returned set holds POST IDS, so the caller keys each ad off the post it
 * follows. Hiding, muting or removing a post above does not renumber anything
 * below it, so a visible Hilltop unit is not unmounted and re-requested by an
 * unrelated change further up the feed. This is the same lesson `anchorId`
 * records for the existing slots, applied rather than re-learned.
 */
export function useHilltopFeedSlots(postIds: string[]): Set<string> {
  const [config, setConfig] = useState<HilltopConfig>(DEFAULT_HILLTOP);

  useEffect(() => {
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { hilltop?: HilltopConfig }) => {
        if (alive && d.hilltop) setConfig(d.hilltop);
      })
      .catch(() => {
        /* No feed ad is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => {
    const anchors = new Set<string>();
    if (!isHilltopPlacementOn(config, "feed")) return anchors;
    const every = config.feedEvery;
    /*
      Never a TRAILING slot. A unit after the last loaded post sits on top of
      the infinite-scroll sentinel, so it is inside the observer's root margin
      the moment it mounts and every batch would load an ad the reader has not
      reached. `insertAdSlots` records the same rule for the same reason.
    */
    for (let i = every - 1; i < postIds.length - 1; i += every) {
      const id = postIds[i];
      if (id) anchors.add(id);
    }
    return anchors;
  }, [config, postIds]);
}

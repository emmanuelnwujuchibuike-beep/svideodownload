"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { MonetagPlacementTag, MonetagTag } from "@/lib/monetization/monetag";

/**
 * Deferred, self-fetching client host for the Monetag injectors.
 *
 * ── Fetches its config, so admin changes show immediately ─────────────────────
 *
 * The marketing pages are static (ISR), so a server-baked Monetag tag only updates
 * when the page regenerates — which is why an admin change appeared not to "take".
 * This fetches the fresh config from `/api/monetag` on the client instead (the same
 * freshness the placed ads get from `/api/ads`), so a change shows within seconds,
 * no rebuild.
 *
 * ── Off the landing critical path ─────────────────────────────────────────────
 *
 * The fetch + the injectors are code-split and deferred to the frame after first
 * paint (double-rAF), like `DeferredAdFurniture` — the landing's two-second budget
 * pays nothing for Monetag. Premium (Pro/Business ad-free) and page-scope gating
 * happen inside the injectors, which receive only safe, already-parsed data.
 */

const MonetagTags = dynamic(() => import("./monetag-tags").then((m) => m.MonetagTags), {
  ssr: false,
});
const MonetagPlacements = dynamic(
  () => import("./monetag-placements").then((m) => m.MonetagPlacements),
  { ssr: false },
);

interface MonetagConfig {
  tags: MonetagTag[];
  placements: MonetagPlacementTag[];
  allPages: boolean;
  surfaces: string[];
}

export function MonetagClient() {
  const [config, setConfig] = useState<MonetagConfig | null>(null);

  useEffect(() => {
    let alive = true;
    // Two rAFs keep the fetch + import off the first paint; then pull the fresh
    // config so an admin change is reflected without a rebuild.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        fetch("/api/monetag")
          .then((r) => (r.ok ? r.json() : null))
          .then((d: MonetagConfig | null) => {
            if (alive && d) setConfig(d);
          })
          .catch(() => {
            /* config unavailable — show nothing rather than guess */
          });
      });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  if (!config) return null;
  const { tags, placements, allPages, surfaces } = config;
  if (tags.length === 0 && placements.length === 0) return null;

  return (
    <>
      {tags.length > 0 ? <MonetagTags tags={tags} allPages={allPages} surfaces={surfaces} /> : null}
      {placements.length > 0 ? (
        <MonetagPlacements placements={placements} allPages={allPages} surfaces={surfaces} />
      ) : null}
    </>
  );
}

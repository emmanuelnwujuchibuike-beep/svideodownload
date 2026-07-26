"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { MonetagPlacementTag, MonetagTag } from "@/lib/monetization/monetag";

/**
 * Deferred client host for the Monetag injectors.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * Monetag runs site-wide from the root layout, so anything it statically imports
 * lands in the shared bundle every page pays for — including the landing page,
 * whose whole budget is a two-second cold open gated on the first hydration task.
 * The injectors (and the path matchers they carry) are not needed at first paint,
 * and Monetag is off by default, so they must not weigh the landing down.
 *
 * So the two injectors are code-split (`next/dynamic`) and mounted on the frame
 * AFTER the first paint — the exact pattern `DeferredAdFurniture` uses for the ad
 * furniture. `ssr: false` is safe here for the same reason: they render nothing on
 * the server (they gate on the client-only plan + path), so nothing races the
 * import.
 *
 * The server (`MonetagScript`) still does the parsing and passes only safe,
 * validated data down — this host adds no new trust surface.
 */

const MonetagTags = dynamic(() => import("./monetag-tags").then((m) => m.MonetagTags), {
  ssr: false,
});
const MonetagPlacements = dynamic(
  () => import("./monetag-placements").then((m) => m.MonetagPlacements),
  { ssr: false },
);

export function MonetagClient({
  tags,
  placements,
  allPages,
  surfaces,
}: {
  tags: MonetagTag[];
  placements: MonetagPlacementTag[];
  allPages: boolean;
  surfaces: string[];
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Two rAFs: keep the import + hydration off the first paint, but mount within
    // a frame or two rather than the multiple seconds an idle-callback could cost.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setMounted(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  if (!mounted) return null;

  return (
    <>
      {tags.length > 0 ? <MonetagTags tags={tags} allPages={allPages} surfaces={surfaces} /> : null}
      {placements.length > 0 ? (
        <MonetagPlacements placements={placements} allPages={allPages} surfaces={surfaces} />
      ) : null}
    </>
  );
}

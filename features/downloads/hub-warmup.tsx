"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { RAIL_LESSON_SLUGS } from "@/lib/learning/catalog";
import { afterInteractive } from "@/lib/loading/priority";
import { getSyncConditions } from "@/lib/media/network-conditions";

/**
 * Download Hub warm-up.
 *
 * The Hub's most-used surfaces are all code-split or on another route, which is
 * correct for first paint and wrong for the moment they are actually needed:
 * after a download completes, the Discovery Gateway chunk has to be fetched
 * before the panel can render, so the panel arrives late on a slow connection.
 * Same for the destinations it recommends.
 *
 * This pulls both forward into idle time, so by the time someone finishes a
 * download the chunk is parsed and the destination routes are prefetched — the
 * panel and every button it offers open instantly.
 *
 * Three rules keep this from being the usual "prefetch everything" mistake:
 *
 *  1. It runs through `afterInteractive`, so it never competes with hydration,
 *     first paint, or an in-flight interaction.
 *  2. It is skipped entirely on Save-Data or a 2G-class connection. Speculative
 *     downloads are a real cost on a metered plan, and someone who has asked
 *     their browser to conserve data has answered this question already.
 *  3. It only prefetches destinations that actually EXIST. A `planned` Gateway
 *     action has no route to warm, and asking Next to prefetch one would be a
 *     wasted request against a 404.
 *
 * Renders nothing.
 */
export function HubWarmup() {
  const router = useRouter();

  useEffect(() => {
    const { saveData, effectiveType } = getSyncConditions();
    // Rule 2 — respect an explicit conservation signal rather than overriding it.
    if (saveData || effectiveType === "slow-2g" || effectiveType === "2g") return;

    let cancelled = false;

    /*
      Everything happens inside the idle callback, including the imports.

      That is deliberate and load-bearing for bundle size: importing
      `GATEWAY_ACTIONS` at module scope pulls the whole action catalogue AND its
      lucide icon references into the /downloads page bundle, which cost 4.8 kB
      for code this component only ever runs on idle. Importing it here instead
      means it rides the SAME chunk fetch that warms the Gateway — one request,
      two purposes, nothing added to first load.
    */
    const cancel = afterInteractive(() => {
      void (async () => {
        // Warms the panel chunk — the one thing guaranteed to be needed the
        // moment a download finishes.
        const [{ GATEWAY_ACTIONS }, { resolveAvailability }] = await Promise.all([
          import("@/lib/download-hub/actions"),
          import("@/lib/download-hub/recommend"),
          import("@/features/download-hub/discovery-gateway"),
        ]);
        if (cancelled) return;

        const routes = new Set<string>(["/learn"]);
        for (const action of GATEWAY_ACTIONS) {
          // Rule 3 — a planned action targets a waitlist, not a page.
          if (action.target.type !== "route") continue;
          if (resolveAvailability(action) === "planned") continue;
          routes.add(action.target.href);
        }
        for (const slug of RAIL_LESSON_SLUGS) routes.add(`/learn/${slug}`);

        for (const route of routes) {
          if (cancelled) return;
          try {
            router.prefetch(route);
          } catch {
            // A prefetch failure is never worth surfacing — the route still
            // works, it just loads on demand.
          }
        }
      })().catch(() => {
        // Warm-up is pure optimisation. A failed chunk fetch (offline, cache
        // miss mid-deploy) must stay silent — everything still works on demand,
        // and an unhandled rejection here would surface in error reporting as if
        // something real had broken.
      });
    });

    return () => {
      cancelled = true;
      cancel();
    };
  }, [router]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";

import type { AdSlotData } from "@/lib/monetization/types";

import { injectAdMarkup } from "./inject";

/**
 * Loads page-level ad scripts (Adsterra Social Bar / Pop-under, PropellerAds
 * OnClick / Multitag) from the `global` zone and injects them once per page
 * load. Premium users get nothing (the API returns an empty list). Renders no
 * visible UI.
 */
export function AdScripts() {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    fetch("/api/ads?zone=global&all=1")
      .then((r) => (r.ok ? r.json() : { ads: [] }))
      .then((d) => {
        for (const ad of (d.ads ?? []) as AdSlotData[]) {
          if (ad.scriptCode) injectAdMarkup(document.body, ad.scriptCode);
        }
      })
      .catch(() => {});
  }, []);

  return null;
}

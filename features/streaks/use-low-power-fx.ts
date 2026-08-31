"use client";

import { useEffect, useState } from "react";

/**
 * Should decorative effects run at reduced density on this device? (§15)
 *
 * ── One decision, two surfaces ───────────────────────────────────────────────
 *
 * The flame mark and the milestone ceremony both thin out their particle work
 * on weak hardware, and both key off the SAME `.streak-fx-lite` class — so the
 * capability question is answered here, once, rather than twice with two
 * heuristics that can disagree. A phone that gets the lite flame and the full
 * ceremony would be the worst of both.
 *
 * ── 🔴 It returns `false` until after mount, deliberately ────────────────────
 *
 * The class this drives changes the rendered markup. Deciding it during the
 * server render — or during the first client render, from a value the server
 * could not know — makes the two disagree, and React's answer to a hydration
 * mismatch is to throw away the server markup and re-render the subtree. On the
 * landing page that is main-thread time inside the exact window this project
 * has spent two sessions clearing. One frame of full effects on a slow phone
 * costs nothing; a mismatch is not free.
 *
 * ── The default is FULL ──────────────────────────────────────────────────────
 *
 * Both signals are advisory and widely absent (`deviceMemory` is Chromium-only;
 * `hardwareConcurrency` is missing or capped on several browsers). A browser
 * that tells us nothing is treated as capable, because degrading everyone to be
 * safe is how a premium feature quietly stops being premium.
 */
export function useLowPowerFx(): boolean {
  const [lite, setLite] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const cores = navigator.hardwareConcurrency;
    /*
      `deviceMemory` is reported in GiB, rounded DOWN to a power of two —
      0.25 / 0.5 / 1 / 2 / 4 / 8. Anything at or under 4 is a budget phone.
      Zero and undefined mean "not reported" and must not count as low.
    */
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const weakCpu = typeof cores === "number" && cores > 0 && cores <= 4;
    const weakMem = typeof memory === "number" && memory > 0 && memory <= 4;
    if (weakCpu || weakMem) setLite(true);
  }, []);

  return lite;
}

/** The class both surfaces apply. Exported so neither hard-codes the string. */
export const LOW_POWER_FX_CLASS = "streak-fx-lite";

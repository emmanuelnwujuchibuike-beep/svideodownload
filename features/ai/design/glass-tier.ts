"use client";

import { useEffect } from "react";

/**
 * Part 7 §57 — the PERFORMANCE input to the AI glass fallback hierarchy.
 *
 * The other three inputs (browser support, reduced motion, reduced
 * transparency / contrast) are pure CSS in globals.css under `.ai-glass`. A
 * device's memory and core count are not visible to CSS, so this writes one
 * attribute the stylesheet selects on: `html[data-glass="reduced"]` drops the
 * blur from 8px to 4px and raises the fill to compensate.
 *
 * ── 🔴 DELIBERATELY STRICTER THAN `classifyDevice` ──────────────────────────
 *
 * The first version reused the media engine's `classifyDevice`, which calls a
 * device "low" at `cores <= 4`. Measured on the production build 2026-10-05:
 * an ordinary 4-core desktop got reduced glass. That threshold is right for
 * the video ladder, where pessimism only costs a shallower preload window; for
 * the glass it visibly downgrades the premium design on mainstream 4-core
 * laptops and phones — §70, "do not optimize the interface by removing the
 * premium visual identity". So reduced glass is for genuinely constrained
 * hardware only: <= 2 GiB reported memory, or <= 2 cores.
 *
 * Unknown is NOT weak: Safari exposes no `deviceMemory`, and degrading
 * everyone we cannot measure is how a premium surface quietly stops being one.
 *
 * Runs once per mount: no timer, no listener, no request. The attribute is set
 * after hydration on purpose (never during render) — the server cannot know,
 * and deciding it in the first client render would mismatch.
 */
export function glassTierFor(memoryGb: number | undefined, cores: number | undefined): "full" | "reduced" {
  if (memoryGb !== undefined && memoryGb > 0 && memoryGb <= 2) return "reduced";
  if (cores !== undefined && cores > 0 && cores <= 2) return "reduced";
  return "full";
}

export function useAiGlassTier(): void {
  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const memory = typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined;
    const cores = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined;
    if (glassTierFor(memory, cores) === "reduced") {
      document.documentElement.setAttribute("data-glass", "reduced");
    }
  }, []);
}

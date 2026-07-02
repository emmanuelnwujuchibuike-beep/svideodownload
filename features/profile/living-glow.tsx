"use client";

import { useEffect, useState } from "react";

/**
 * Living Profile (Feature 4 exclusive #1): the banner's light subtly follows
 * the viewer's time of day — soft blue mornings, bright sky afternoons,
 * electric violet nights. Pure overlay, so custom banner images still show
 * through; renders nothing until mounted to avoid hydration mismatch.
 */
export function LivingGlow() {
  const [phase, setPhase] = useState<"morning" | "day" | "evening" | "night" | null>(null);

  useEffect(() => {
    const h = new Date().getHours();
    setPhase(h < 6 ? "night" : h < 12 ? "morning" : h < 18 ? "day" : h < 22 ? "evening" : "night");
  }, []);

  if (!phase) return null;

  const cls =
    phase === "morning"
      ? "bg-gradient-to-tr from-sky-400/25 via-blue-400/10 to-transparent"
      : phase === "day"
        ? "bg-gradient-to-tr from-cyan-300/20 via-sky-400/10 to-transparent"
        : phase === "evening"
          ? "bg-gradient-to-tr from-violet-500/25 via-fuchsia-500/10 to-transparent"
          : "bg-gradient-to-tr from-indigo-600/30 via-violet-600/15 to-transparent";

  return <div aria-hidden className={`pointer-events-none absolute inset-0 transition-opacity duration-1000 ${cls}`} />;
}

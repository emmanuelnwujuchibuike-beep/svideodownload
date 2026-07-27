"use client";

import { useEffect, useState } from "react";

type Phase = "morning" | "day" | "evening" | "night";
type Season = "winter" | "spring" | "summer" | "autumn";

/**
 * Living Profile™ (Feature 4 exclusive #1 — extended in Part 8). The cover's
 * light subtly evolves with the viewer's world:
 *   • Time of day — soft blue mornings, bright afternoons, electric violet nights.
 *   • Season — a faint cool→warm bias (winter blue … autumn amber).
 *   • Anniversary — a warm golden aura on the owner's Frenz join anniversary.
 * A pure, pointer-events-none overlay so custom banners still show through, and
 * every layer is static CSS (no loops, no timers) so it costs nothing at rest and
 * needs no reduced-motion handling. Renders nothing until mounted to avoid a
 * hydration mismatch, since the values depend on the viewer's local clock.
 */
export function LivingGlow({ joinedAt }: { joinedAt?: string | null }) {
  const [s, setS] = useState<{ phase: Phase; season: Season; anniversary: boolean } | null>(null);

  useEffect(() => {
    const now = new Date();
    const h = now.getHours();
    const phase: Phase = h < 6 ? "night" : h < 12 ? "morning" : h < 18 ? "day" : h < 22 ? "evening" : "night";
    const m = now.getMonth();
    const season: Season = m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
    let anniversary = false;
    if (joinedAt) {
      const j = new Date(joinedAt);
      if (!Number.isNaN(j.getTime())) {
        // The same month + day as the join date, at least a year on.
        anniversary = j.getMonth() === now.getMonth() && j.getDate() === now.getDate() && j.getFullYear() < now.getFullYear();
      }
    }
    setS({ phase, season, anniversary });
  }, [joinedAt]);

  if (!s) return null;

  const phaseCls =
    s.phase === "morning"
      ? "bg-gradient-to-tr from-sky-400/25 via-blue-400/10 to-transparent"
      : s.phase === "day"
        ? "bg-gradient-to-tr from-cyan-300/20 via-sky-400/10 to-transparent"
        : s.phase === "evening"
          ? "bg-gradient-to-tr from-violet-500/25 via-fuchsia-500/10 to-transparent"
          : "bg-gradient-to-tr from-indigo-600/30 via-violet-600/15 to-transparent";

  // A faint seasonal bias, opposite corner to the time-of-day light so the two
  // never stack into one muddy wash.
  const seasonCls =
    s.season === "winter"
      ? "bg-gradient-to-bl from-sky-300/10 to-transparent"
      : s.season === "spring"
        ? "bg-gradient-to-bl from-emerald-300/10 to-transparent"
        : s.season === "summer"
          ? "bg-gradient-to-bl from-amber-300/10 to-transparent"
          : "bg-gradient-to-bl from-orange-400/12 to-transparent";

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className={`absolute inset-0 transition-opacity duration-1000 ${phaseCls}`} />
      <div className={`absolute inset-0 ${seasonCls}`} />
      {s.anniversary ? <div className="absolute inset-0 bg-gradient-to-tr from-amber-300/30 via-yellow-200/12 to-transparent" /> : null}
    </div>
  );
}

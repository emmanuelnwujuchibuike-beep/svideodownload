"use client";

import { useEffect, useRef } from "react";

import { Portal } from "@/components/ui/portal";
import { StreakFlameMark } from "@/features/streaks/streak-flame-mark";
import { LOW_POWER_FX_CLASS, useLowPowerFx } from "@/features/streaks/use-low-power-fx";
import type { StreakTier } from "@/lib/streaks/tiers";

/**
 * THE STREAK CELEBRATION, WITHOUT A CARD (owner, 2026-10-09: "the celebration
 * should be intact but now I don't want the celebration to have a card, I just
 * want the icon bold and large and the fire animation around it and not a card").
 *
 * The tier's flame, large, standing in a ring of upright fire tongues that
 * flicker around it, with a few embers rising. There is no panel, no text on screen (the label is for screen
 * readers) and no buttons. It is pure CSS (transform/opacity on a handful of
 * small layers) with no animation library. A tap anywhere or Escape leaves at
 * once, and it leaves by itself after the burst.
 *
 * Used by the personal streak (StreakUnlockCelebration keeps its haptic, sound
 * and once-a-day claim and renders this) and by chat streaks in the inbox.
 */
/* Fire RISES: each tongue stands upright on a point of a ring around the flame,
   heights varied so the edge reads as fire rather than a pattern. */
const TONGUES = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return { i, x: Math.round(Math.cos(a) * 74), y: Math.round(Math.sin(a) * 58 + 34), h: 70 + ((i * 7) % 5) * 10 };
});
const EMBERS = Array.from({ length: 8 }, (_, i) => i);
const BURST_MS = 2600;

export function StreakFireBurst({ tier, label, onDone }: { tier: StreakTier; label: string; onDone: () => void }) {
  const lite = useLowPowerFx();
  const done = useRef(false);
  const finish = useRef(onDone);
  finish.current = onDone;

  useEffect(() => {
    const leave = () => {
      if (done.current) return;
      done.current = true;
      finish.current();
    };
    const t = window.setTimeout(leave, BURST_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <Portal>
      <div
        role="status"
        aria-live="polite"
        onPointerDown={() => {
          if (done.current) return;
          done.current = true;
          finish.current();
        }}
        style={{ ["--fb-a" as string]: tier.flame[0], ["--fb-b" as string]: tier.flame[1] }}
        className={`streak-fb fixed inset-0 z-[130] flex items-center justify-center ${lite ? LOW_POWER_FX_CLASS : ""}`}
      >
        <span className="sr-only">{label}</span>
        <span aria-hidden className="streak-fb-glow pointer-events-none absolute" />
        <span aria-hidden className="streak-fb-stage relative flex items-center justify-center">
          <span className="streak-fb-ring pointer-events-none absolute inset-0">
            {/* one warm gradient, shared by every tongue (an SVG id is document-wide) */}
            <svg width="0" height="0" className="absolute" focusable="false">
              <defs>
                <linearGradient id="streak-fb-fire" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#ea580c" />
                  <stop offset="45%" stopColor="#f97316" />
                  <stop offset="80%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#fde68a" />
                </linearGradient>
              </defs>
            </svg>
            {TONGUES.map((t) => (
              <svg
                key={t.i}
                viewBox="0 0 24 24"
                focusable="false"
                className="streak-fb-tongue"
                style={{ ["--i" as string]: t.i, ["--x" as string]: `${t.x}px`, ["--y" as string]: `${t.y}px`, ["--h" as string]: `${t.h}px` }}
              >
                <path fill="url(#streak-fb-fire)" d="M12.9 2.2c.3 2.2-.6 3.8-2 5.2-1.6 1.6-3.6 3-3.6 6a6.7 6.7 0 0 0 13.4.3c0-2.6-1-4.4-2.3-6-.3 1-.9 1.7-1.7 2 .3-2.9-1-5.6-3.8-7.5Z" />
              </svg>
            ))}
          </span>
          {EMBERS.map((i) => (
            <span key={i} className="streak-fb-ember pointer-events-none absolute" style={{ ["--i" as string]: i }} />
          ))}
          <span className="streak-fb-emblem relative">
            <StreakFlameMark tier={tier} effects={false} className="h-[11rem] w-[11rem]" wrapperClassName="h-[11.5rem] w-[11.5rem]" />
          </span>
        </span>
      </div>
    </Portal>
  );
}

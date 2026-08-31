"use client";

import { useEffect, useState } from "react";

import { StreakFlame } from "@/features/streaks/streak-flame";
import { LOW_POWER_FX_CLASS, useLowPowerFx } from "@/features/streaks/use-low-power-fx";
import type { StreakTier } from "@/lib/streaks/tiers";

/**
 * The flame PLUS whatever its tier earns — licks, smoke, or a thunderstorm.
 *
 * ── Why this is a separate component from `StreakFlame` ──────────────────────
 *
 * `StreakFlame` stays pure, hook-free and server-renderable: it is the glyph,
 * and several non-streak places draw it. This wraps it with the decorative
 * layers a RANK earns, so the four streak surfaces — hero chip, profile card,
 * celebration, tier gallery — all get the same treatment from one place. A
 * gold flame that stormed on the chip and sat still on the profile would read
 * as a bug in the streak itself, which is the same reasoning that put the
 * colours in one table to begin with.
 *
 * ── 🔴 The layers mount AFTER hydration, deliberately ────────────────────────
 *
 * `mounted` starts false and the effect flips it, so the server HTML and the
 * first client render are byte-identical: the glyph, no layers. If this instead
 * rendered the layers on the server and the lite/full decision on the client,
 * the two would disagree and React would throw the server markup away and
 * re-render the subtree — a hydration mismatch, on the landing page, in the
 * middle of the exact window this project just spent a session clearing.
 *
 * The cost of waiting is one frame on a decoration nobody is looking at yet;
 * the cost of getting it wrong is measurable in main-thread milliseconds.
 *
 * ── Device awareness (§15) ───────────────────────────────────────────────────
 *
 * Read once, after mount, from what the browser will actually tell us. Both
 * signals are advisory and widely missing, so the DEFAULT IS FULL: a browser
 * that reports nothing is treated as capable, because degrading everyone to be
 * safe is how a premium feature quietly stops being premium.
 */

/** Three tongues, staggered so the fire reads as continuous rather than pulsed. */
const LICKS = [
  { dur: "1.45s", delay: "0s", x: "-50%" },
  { dur: "1.75s", delay: "0.42s", x: "-64%" },
  { dur: "1.6s", delay: "0.86s", x: "-36%" },
] as const;

/** Puffs drift on different curves; identical drift reads as one moving object. */
const PUFFS = [
  { dur: "2.7s", delay: "0s", drift: "7px" },
  { dur: "3.3s", delay: "0.9s", drift: "-9px" },
  { dur: "3s", delay: "1.7s", drift: "3px" },
] as const;

export function StreakFlameMark({
  tier,
  className = "h-[20px] w-[20px]",
  wrapperClassName = "",
  /** Off for tiny placements where the layers would be noise rather than rank. */
  effects = true,
}: {
  tier: StreakTier | null;
  /** Sizing for the glyph itself. */
  className?: string;
  /** Sizing/positioning for the wrapper that clips the effects. */
  wrapperClassName?: string;
  effects?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const lite = useLowPowerFx();

  useEffect(() => setMounted(true), []);

  const motion = tier?.motion ?? "steady";
  const show = mounted && effects && motion !== "steady";

  return (
    <span className={`streak-mark ${wrapperClassName} ${lite ? LOW_POWER_FX_CLASS : ""}`}>
      {show ? (
        <span aria-hidden className="streak-mark-fx">
          {motion === "ascend"
            ? LICKS.map((l, i) => (
                <span
                  key={i}
                  className="streak-lick"
                  style={{
                    ["--lick-dur" as string]: l.dur,
                    ["--lick-delay" as string]: l.delay,
                    // The tier's bright stop is the tongue colour, so a future
                    // tier that opts into `ascend` needs no CSS of its own.
                    ["--streak-lick-a" as string]: tier?.flame[1],
                    left: l.x === "-50%" ? "50%" : `calc(50% + ${l.x === "-64%" ? "-3px" : "3px"})`,
                  }}
                />
              ))
            : null}
          {motion === "smoke"
            ? PUFFS.map((p, i) => (
                <span
                  key={i}
                  className="streak-smoke"
                  style={{
                    ["--smoke-dur" as string]: p.dur,
                    ["--smoke-delay" as string]: p.delay,
                    ["--smoke-drift" as string]: p.drift,
                  }}
                />
              ))
            : null}
          {motion === "storm" ? (
            <>
              <span className="streak-rim" style={{ ["--streak-rim" as string]: tier?.glow }} />
              <span className="streak-bolt">
                {/*
                  A drawn bolt, not a flash of colour. The strike is the moment
                  the rank announces itself, and a shapeless white blink is
                  indistinguishable from a repaint bug.
                */}
                <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden focusable="false">
                  <path
                    d="M13.6 1.5 5.2 13.1h5.1L9.4 22.5l8.6-11.9h-5.2l.8-9.1Z"
                    fill={tier?.flame[1] ?? "#E3B341"}
                    opacity="0.9"
                  />
                </svg>
              </span>
            </>
          ) : null}
        </span>
      ) : null}
      <StreakFlame className={`relative ${className}`} gradient animated tier={tier} />
    </span>
  );
}

/**
 * The class the CHIP needs so the storm reaches the button too.
 *
 * Owner asked for thunder "around the fire icon and streak button", and the
 * button is not this component's to render — so the pairing is exported rather
 * than duplicated as a string literal at each call site.
 */
export function chipStormClass(tier: StreakTier | null, mounted = true): string {
  return mounted && tier?.motion === "storm" ? "streak-chip-storm" : "";
}

"use client";

import { useEffect, useRef, useState } from "react";

import { formatCents } from "@/lib/ai/economy";

/**
 * A money figure that COUNTS to its new value instead of jumping.
 *
 * Owner, 2026-09-13: "Let users' balance update in a premium fast count
 * animation the way they make a deposit."
 *
 * ── What moves, and what does not ──────────────────────────────────────────
 *
 *   · The FIRST paint shows the real value, instantly. Counting up from zero
 *     on every page open would show a balance nobody has, for most of a
 *     second, to somebody who just wants to read theirs.
 *   · A CHANGE — a verified deposit, a charge, a refund — tweens from the
 *     figure that was on screen to the new one. Fast: 900 ms, ease-out-expo,
 *     so it is almost there in the first third and settles for the rest. That
 *     is the "fintech ticker" feel without a slow crawl.
 *   · Under `prefers-reduced-motion` it jumps. Motion that somebody asked
 *     not to see is not premium.
 *
 * ── Cheap by construction ──────────────────────────────────────────────────
 *
 * One `requestAnimationFrame` loop that writes a string into state; no layout
 * animation, no library. `tabular-nums` on the caller keeps the width steady
 * so the digits tick in place rather than the row reflowing. The loop is
 * cancelled on unmount and restarted from the CURRENT displayed value if a
 * second change arrives mid-flight, so two deposits in a row do not fight.
 */
const DURATION_MS = 900;

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function AnimatedAmount({
  cents,
  symbol,
  className,
}: {
  cents: number;
  symbol: string;
  className?: string;
}) {
  const [shown, setShown] = useState(cents);
  const shownRef = useRef(cents);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const from = shownRef.current;
    const to = cents;
    if (from === to) return;

    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      shownRef.current = to;
      setShown(to);
      return;
    }

    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const value = Math.round(from + (to - from) * easeOutExpo(t));
      shownRef.current = value;
      setShown(value);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        frame.current = null;
      }
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [cents]);

  return (
    <span className={className} aria-live="polite" aria-atomic="true">
      {formatCents(shown, symbol)}
    </span>
  );
}

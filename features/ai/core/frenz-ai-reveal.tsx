"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A result arriving.
 *
 * ── Why a wrapper and not a class on each result ─────────────────────────────
 *
 * The brief asks for a reveal that makes a result feel created rather than
 * loaded — glow, blur, materialise, sharpen, then controls. Written inline it
 * would be three components each doing a slightly different version of it. One
 * wrapper means every Frenz AI result in the product resolves the same way, and
 * the timing is tunable in a single place.
 *
 * ── 🔴 IT RUNS ONCE ──────────────────────────────────────────────────────────
 *
 * This is the one animation in the system allowed to touch `filter`, because
 * blur is what sells the materialise and it runs for 620ms on one element, once
 * per result. On an idle loop it would be the most expensive thing on the page.
 * `animation-fill-mode: both` leaves it settled and static afterwards, so there
 * is nothing left running when the member starts using the controls.
 *
 * The controls follow the media rather than arriving with it — a short,
 * deliberate beat, so the eye lands on the result before the buttons.
 */
export function FrenzAIReveal({
  children,
  /** Rendered after the media has settled. Buttons, facts, actions. */
  controls,
  className,
}: {
  children: ReactNode;
  controls?: ReactNode;
  className?: string;
}) {
  const [controlsIn, setControlsIn] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    // 380ms: after the blur has mostly cleared and before the scale settles, so
    // the two overlap rather than reading as two separate events.
    timer.current = window.setTimeout(() => setControlsIn(true), 380);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className={className}>
      <div className="frenz-ai-materialize">{children}</div>
      {controls ? (
        <div
          className={cn(
            "transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none",
            controlsIn ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
          )}
        >
          {controls}
        </div>
      ) : null}
    </div>
  );
}

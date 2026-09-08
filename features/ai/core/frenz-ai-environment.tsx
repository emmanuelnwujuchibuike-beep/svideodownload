"use client";

import { useEffect, useState, type ReactNode } from "react";

import { presenceFor, presenceVars, type PresenceLevel } from "@/lib/ai/presence";
import type { AiCleanStage } from "@/lib/ai/job-stages";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI ENVIRONMENT — the room everything else stands in
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One wrapper. It decides the presence level, writes four CSS custom properties,
 * and paints the ambient light. Every animated Frenz AI surface below it reads
 * those properties, so the whole environment changes state together — and does
 * it without React touching a single animated node.
 *
 * ── 🔴 THIS IS THE ONLY COMPONENT ALLOWED TO KNOW ABOUT MOTION PREFERENCES ───
 *
 * `prefers-reduced-motion` and tab visibility are resolved HERE, once, and
 * expressed as `--ai-play: paused` plus a `dormant` level. Components below
 * never check either. That is what stops the usual outcome where three
 * surfaces each implement the preference slightly differently and one of them
 * keeps moving.
 *
 * ── The idle motion is deliberately almost invisible ─────────────────────────
 *
 * The brief asks for a background that drifts and occasionally pulses. The
 * standing battery rule says a phone left on a page must not warm up. Both are
 * satisfied by making the idle cycle 38 seconds long and compositor-only: it
 * reads as light in a room rather than as an animation, and it stops dead the
 * moment the tab is hidden — which is most of the time a page is open on a
 * phone.
 */
export function FrenzAIEnvironment({
  stage = "idle",
  armed = false,
  /** Skip the ambient wash — for surfaces that only want the presence variables. */
  bare = false,
  className,
  children,
}: {
  stage?: AiCleanStage;
  armed?: boolean;
  bare?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);

    const onVisibility = () => setHidden(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const presence = presenceFor({ stage, armed, reducedMotion, hidden });

  return (
    <div
      className={cn("relative isolate", className)}
      style={presenceVars(presence)}
      data-ai-presence={presence}
    >
      {!bare && <AmbientLight presence={presence} />}
      {children}
    </div>
  );
}

/**
 * The light in the room.
 *
 * Two soft radials on their own compositor layers, drifting on a very long
 * cycle. `-z-10` and `pointer-events-none` keep them behind and inert; the
 * content above always sits on a real surface colour, so no text is ever read
 * against a moving gradient — which is where this pattern usually fails
 * contrast.
 */
function AmbientLight({ presence }: { presence: PresenceLevel }) {
  const still = presence === "dormant";

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className={cn("absolute -left-[15%] -top-[35%] h-[70%] w-[70%] rounded-full blur-3xl", !still && "frenz-ai-drift")}
        style={{
          background: "radial-gradient(circle, hsl(var(--brand-blue) / 0.5), transparent 68%)",
          opacity: "calc(var(--ai-intensity, 0.28) * 0.5)",
        }}
      />
      <div
        className={cn("absolute -right-[20%] top-[10%] h-[75%] w-[75%] rounded-full blur-3xl", !still && "frenz-ai-drift")}
        style={{
          background: "radial-gradient(circle, hsl(var(--brand-purple) / 0.45), transparent 70%)",
          opacity: "calc(var(--ai-intensity, 0.28) * 0.45)",
          // Offset so the two never crest together — one light source moving is
          // mechanical; two out of phase reads as atmosphere.
          animationDelay: "-9s",
        }}
      />
      {/*
        A cyan highlight, low and wide. The brief's accent colour, used as a rim
        of light rather than a surface — and never as the dominant hue.
      */}
      <div
        className="absolute -bottom-[30%] left-[20%] h-[45%] w-[60%] rounded-full blur-3xl"
        style={{
          background: "radial-gradient(circle, hsl(190 95% 55% / 0.28), transparent 70%)",
          opacity: "calc(var(--ai-intensity, 0.28) * 0.35)",
        }}
      />
    </div>
  );
}

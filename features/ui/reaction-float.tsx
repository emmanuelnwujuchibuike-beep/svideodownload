"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useSyncExternalStore } from "react";

import { WowSolid } from "@/components/brand/wow-icon";

/**
 * Premium floating-reaction layer. Fire `floatReaction(x, y)` (viewport
 * coordinates — usually the tap point) and the reaction pops in with a spring,
 * floats 100–140px upward while drifting and rotating slightly, grows to
 * ~170%, then fades — the "reactions rising into the air" effect. Every emit
 * is independently randomized (drift, rotation, height, tiny delay) so rapid
 * taps feel alive, never mechanical. Transform/opacity only (GPU), pointer
 * events off, self-cleaning, and many can run at once.
 *
 * <ReactionFloatLayer /> is mounted once (root layout); emitters just call
 * `floatReaction`. `emoji` renders a picker emoji as content instead of the
 * Wow mark (owner's no-emoji rule covers UI chrome, not user reactions).
 */

interface Floater {
  id: number;
  x: number;
  y: number;
  drift: number;
  rise: number;
  rotate: number;
  delay: number;
  emoji?: string;
}

let floaters: Floater[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  floaters = [...floaters];
  for (const l of listeners) l();
};

export function floatReaction(x: number, y: number, emoji?: string): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* no haptics */
  }
  floaters.push({
    id: nextId++,
    x,
    y,
    drift: (Math.random() * 2 - 1) * 20, // ±20px
    rise: 100 + Math.random() * 40, // 100–140px
    rotate: (Math.random() * 2 - 1) * 8, // ±8°
    delay: Math.random() * 0.04, // 0–40ms
    emoji,
  });
  emit();
}

function remove(id: number) {
  floaters = floaters.filter((f) => f.id !== id);
  emit();
}

export function ReactionFloatLayer() {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => floaters,
    () => floaters,
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[120]">
      <AnimatePresence>
        {items.map((f) => (
          <motion.span
            key={f.id}
            initial={{ x: f.x, y: f.y, scale: 0.8, opacity: 0, rotate: 0 }}
            animate={{
              x: [f.x, f.x + f.drift * 0.4, f.x + f.drift],
              y: [f.y, f.y - f.rise * 0.45, f.y - f.rise],
              scale: [0.8, 1.15, 1, 1.45, 1.7],
              rotate: [0, f.rotate * 0.5, f.rotate],
              opacity: [0, 1, 1, 1, 0],
            }}
            transition={{
              duration: 1.2,
              delay: f.delay,
              times: [0, 0.1, 0.18, 0.75, 1],
              ease: [0.22, 0.61, 0.36, 1],
            }}
            onAnimationComplete={() => remove(f.id)}
            className="absolute left-0 top-0 -ml-4 -mt-4 will-change-transform motion-reduce:hidden"
          >
            {f.emoji ? <span className="text-3xl leading-none drop-shadow">{f.emoji}</span> : <WowSolid className="h-8 w-8" />}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

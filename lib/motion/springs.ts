import type { Transition } from "framer-motion";

/**
 * Frenz Motion — the single spring-physics vocabulary shared by every
 * interactive control (nav icons, buttons, cards). Tune a preset here and
 * every surface using it moves the same way. Values favor a quick settle
 * (short mass, high stiffness) over a long wobble — premium reads as
 * "instant and controlled", not "bouncy".
 */
export const springs = {
  /** Icon/button press feedback — snappy compression on tap. */
  press: { type: "spring", stiffness: 500, damping: 30, mass: 0.5 } satisfies Transition,
  /** State-change emphasis — a small overshoot when a tab becomes active. */
  bounce: { type: "spring", stiffness: 380, damping: 15, mass: 0.6 } satisfies Transition,
  /** Celebratory/elastic moments — pronounced overshoot, used sparingly. */
  elastic: { type: "spring", stiffness: 260, damping: 11, mass: 0.7 } satisfies Transition,
} as const;

export const REDUCED_MOTION_TRANSITION: Transition = { duration: 0 };

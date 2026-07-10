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
  /** Bottom-sheet / modal entrance — the app's single most-repeated hand-rolled
   *  spring (7 near-identical copies found across share/repost/collection/
   *  download/comment sheets before this token existed). Use for anything
   *  sliding up from an edge. */
  sheet: { type: "spring", stiffness: 420, damping: 38 } satisfies Transition,
} as const;

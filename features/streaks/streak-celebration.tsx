"use client";

import { useEffect, useRef, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { StreakFlame } from "@/features/streaks/streak-flame";
import { markStreakCelebrated } from "@/features/streaks/use-streak";

/**
 * The once-a-day streak celebration.
 *
 * ── 🔴 ONCE PER CALENDAR DAY, DECIDED BY THE SERVER ──────────────────────
 * This component never decides whether to appear. It is mounted only when the
 * server said `shouldCelebrate`, and the first thing it does is POST
 * `/api/streak/celebrated` so the server writes today's date. Every later
 * refresh, route change, PWA relaunch or Profile visit gets
 * `shouldCelebrate: false` from the same server and mounts nothing.
 *
 * Deciding on the client — a localStorage "seen today" flag — would have been
 * simpler and wrong: it replays after a storage clear, replays on a second
 * device, and can be edited to replay forever.
 *
 * ── 🔴 PORTALLED ────────────────────────────────────────────────────────
 * A `fixed inset-0` overlay clips to the nearest transformed/filtered
 * ancestor, and this app's page-transition wrapper and blurred chrome are
 * exactly that — a scrim rendered in place ends up as an "unprofessional
 * square". `components/ui/portal.tsx` is the house rule for this.
 */

/** Long enough to register, short enough not to be in the way (§29). */
const VISIBLE_MS = 2600;

export function StreakCelebration({ streak, onDone }: { streak: number; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const marked = useRef(false);

  useEffect(() => {
    // Claim the day immediately, not on dismiss: a viewer who navigates away
    // mid-animation must not see it again on the next page.
    if (!marked.current) {
      marked.current = true;
      void markStreakCelebrated();
    }
    const hide = setTimeout(() => setLeaving(true), VISIBLE_MS);
    const done = setTimeout(onDone, VISIBLE_MS + 260);
    return () => {
      clearTimeout(hide);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <Portal>
      <div
        /*
          `role="status"` + `aria-live="polite"`: a screen reader hears "12 day
          streak" once, without the focus trap a dialog would impose on a thing
          that dismisses itself. Not focusable, and it never steals focus —
          it interrupts nothing the user was doing.
        */
        role="status"
        aria-live="polite"
        onClick={() => setLeaving(true)}
        className={`streak-celebration-scrim fixed inset-0 z-[120] flex flex-col items-center justify-center bg-background/92 transition-opacity duration-250 ${
          leaving ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        {/* A single static radial wash. Not a particle system, not animated
            blur — the two effects that cook a low-end phone. */}
        <span
          aria-hidden
          className="streak-celebration-flare pointer-events-none absolute h-[min(70vw,320px)] w-[min(70vw,320px)] rounded-full bg-[radial-gradient(circle,rgba(251,146,60,0.42),transparent_68%)]"
        />

        <span className="streak-celebration-mark relative">
          <StreakFlame className="h-24 w-24 drop-shadow-[0_10px_30px_rgba(249,115,22,0.45)]" gradient />
        </span>

        <p className="streak-celebration-count relative mt-3 text-[clamp(1.9rem,10vw,3rem)] font-extrabold tracking-[-0.03em]">
          <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 bg-clip-text text-transparent">
            {streak} DAY STREAK!
          </span>
        </p>

        <p className="streak-celebration-sub relative mt-1.5 text-[14px] font-medium text-muted-foreground">
          {streak} consecutive days on Frenzsave
        </p>
      </div>
    </Portal>
  );
}

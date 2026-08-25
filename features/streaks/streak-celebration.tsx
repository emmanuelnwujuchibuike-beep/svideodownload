"use client";

import { useEffect, useRef, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { playSound } from "@/lib/notifications/sound-fx";
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
      /*
        Fires once a day, with the celebration. `playSound` already honours the
        member's master sound switch and stays silent when the AudioContext was
        never unlocked by a gesture — so this can never be the thing that makes
        a phone blurt in a quiet room, and needs no switch of its own.
      */
      playSound("streak");
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
          className="streak-celebration-flare pointer-events-none absolute h-[min(78vw,360px)] w-[min(78vw,360px)] rounded-full bg-[radial-gradient(circle,rgba(251,146,60,0.45),transparent_68%)]"
        />

        {/* Two expanding rings. Pure transform + opacity, so they run on the
            compositor and cost nothing to animate — the "luxury" here is
            timing and restraint, not more effects. */}
        <span aria-hidden className="streak-celebration-ring pointer-events-none absolute h-40 w-40 rounded-full border border-amber-400/45" />
        <span aria-hidden className="streak-celebration-ring streak-celebration-ring-2 pointer-events-none absolute h-40 w-40 rounded-full border border-orange-500/30" />

        <span className="streak-celebration-mark relative">
          <StreakFlame className="h-[6.5rem] w-[6.5rem] drop-shadow-[0_14px_38px_rgba(249,115,22,0.5)]" gradient />
        </span>

        {/*
          🔴 THE NUMBER IS THE MESSAGE (owner, 2026-08-24: "make the text more
          visible and less, not long words or sentence").

          It was "{n} DAY STREAK!" over "{n} consecutive days on Frenzsave" —
          the same fact told twice, the second time as a sentence nobody reads
          in the 2.6s this is on screen. Now the count carries it: one huge
          numeral, one two-word label. Bigger type, far less of it.
        */}
        <p className="streak-celebration-count relative mt-1 text-[clamp(4.5rem,26vw,8rem)] font-black leading-[0.9] tracking-[-0.055em]">
          <span className="streak-celebration-shine bg-gradient-to-r from-amber-300 via-orange-500 to-rose-500 bg-clip-text text-transparent">
            {streak}
          </span>
        </p>

        <p className="streak-celebration-sub relative mt-2 text-[13px] font-bold uppercase tracking-[0.42em] text-amber-500/90 dark:text-amber-400/90">
          {/* "DAY" / "DAYS" — a "1 DAYS STREAK" on someone's first day is the
              kind of small wrongness that undercuts the whole moment. */}
          Day{streak === 1 ? "" : "s"} streak
        </p>
      </div>
    </Portal>
  );
}

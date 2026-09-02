"use client";

import { useEffect, useRef, useState } from "react";

import { StreakFlameMark } from "@/features/streaks/streak-flame-mark";
import { restoreStreak } from "@/features/streaks/use-streak";
import { tierFor } from "@/lib/streaks/tiers";
import type { StreakState } from "@/lib/streaks/types";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  STREAK BROKEN · RESTORE · START AGAIN  (§6, §7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-01: "When the user misses the required activity and breaks
 * their streak, DO NOT show a generic error modal. Create a premium 'Streak
 * Broken' state that uses the user's CURRENT FLAME."
 *
 * ── 🔴 THE FLAME GALLERY IS NEVER TOUCHED BY A BREAK ─────────────────────────
 *
 * "Unlocking a flame is a PERMANENT ACHIEVEMENT. Breaking the current streak
 * should NOT remove previously unlocked flames from the Flame Gallery."
 *
 * That is enforced one level up, in the gallery, by reading `longestStreak`
 * (monotonic, and the only field a break cannot lower) for what is UNLOCKED,
 * and `currentStreak` only for where you are standing right now. This component
 * exists to make the loss legible without ever being the thing that erases it —
 * it shows the flame that went out, and the gallery still shows you own it.
 *
 * ── One component, three states, because they are one story ──────────────────
 *
 * Broken-and-recoverable, broken-and-expired, and just-restored are the same
 * card at three moments, and splitting them into three components is how the
 * middle one ends up looking like it belongs to a different product. Which one
 * renders is decided entirely by the SERVER's state — `canRestore` is the only
 * thing that may say a restore is possible, because it is the only thing with a
 * clock the member cannot move.
 */

/** How often the countdown re-renders. Minute granularity needs no more. */
const TICK_MS = 20_000;

export function StreakRecovery({
  state,
  className,
  /** The gallery wants to close itself after "Start new streak"; the card does not. */
  onDismiss,
}: {
  state: StreakState;
  className?: string;
  onDismiss?: () => void;
}) {
  const [restored, setRestored] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /*
    The window has closed if there WAS a break (`restoreDeadline` is set) and
    the server nonetheless refuses the restore — which covers both of the ways
    §7 says it can close: past 48 hours, or out of restoration credits.
  */
  const broke = !!state.restoreDeadline;
  if (restored === null && !broke) return null;

  if (restored !== null) return <Restored streak={restored} className={className} />;
  if (state.canRestore) {
    return (
      <Restorable
        state={state}
        className={className}
        busy={busy}
        failed={failed}
        onRestore={async () => {
          if (busy) return;
          setBusy(true);
          /*
            The server is the only thing that can approve this. A `false` means
            the window closed or the allowance is spent between render and tap,
            and the honest answer is to say so rather than to retry.
          */
          const ok = await restoreStreak();
          if (ok) setRestored(state.restorableStreak);
          else setFailed(true);
          setBusy(false);
        }}
      />
    );
  }
  return <Expired state={state} className={className} onDismiss={onDismiss} />;
}

/* ── Broken, and still recoverable (§7) ───────────────────────────────────── */

function Restorable({
  state,
  className,
  busy,
  failed,
  onRestore,
}: {
  state: StreakState;
  className?: string;
  busy: boolean;
  failed: boolean;
  onRestore: () => void;
}) {
  const lost = state.restorableStreak;
  const tier = tierFor(lost);
  const remaining = useCountdown(state.restoreExpiresAt);

  return (
    <section className={cn("streak-recover", className)} aria-labelledby="streak-recover-title">
      <div className="flex items-center gap-3">
        {/* 🔴 THEIR flame, weakened — not a warning triangle. §6 is explicit
            that the broken state uses the flame they had. */}
        <BrokenFlame tier={tier} />
        <div className="min-w-0 flex-1">
          <h3 id="streak-recover-title" className="streak-recover-eyebrow">
            Streak broken
          </h3>
          <p className="streak-recover-head">
            Your {lost}-day streak ended.
          </p>
        </div>
      </div>

      <div className="streak-recover-well">
        <p className="streak-recover-lede">Your streak can still be restored</p>
        <p className="streak-recover-body">
          Restore it before your recovery window expires.
        </p>
        {remaining ? (
          <p className="streak-recover-clock">
            <span className="streak-recover-clock-label">Time remaining</span>
            <span className="streak-recover-clock-value">{remaining}</span>
          </p>
        ) : null}
      </div>

      {failed ? (
        <p className="streak-recover-failed">That streak can no longer be restored.</p>
      ) : (
        <button type="button" disabled={busy} onClick={onRestore} className="streak-recover-cta">
          {busy ? "Restoring…" : "Restore streak"}
          {/* §7: "If the user has restoration credits: RESTORE STREAK · 1
              AVAILABLE". Shown only when there is a real number to show — a
              "· 0 available" beside an enabled button would be a contradiction. */}
          {!busy && state.restoresRemaining > 0 ? (
            <span className="streak-recover-credits">
              · {state.restoresRemaining} available
            </span>
          ) : null}
        </button>
      )}
    </section>
  );
}

/* ── Restored (§7) ────────────────────────────────────────────────────────── */

function Restored({ streak, className }: { streak: number; className?: string }) {
  const tier = tierFor(streak);
  return (
    <section className={cn("streak-recover streak-recover-ok", className)} aria-live="polite">
      <div className="flex items-center gap-3">
        {/* Back to its normal active appearance (§7) — the full mark, effects
            and all, which is the visible difference from the weakened one. */}
        <span
          className="streak-recover-flame"
          style={{ boxShadow: `0 0 26px -8px ${tier?.glow ?? "transparent"}` }}
        >
          <StreakFlameMark tier={tier} className="h-8 w-8" wrapperClassName="h-9 w-9" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="streak-recover-eyebrow">Streak restored</h3>
          <p className="streak-recover-head">Your {streak}-day streak is back.</p>
        </div>
      </div>
    </section>
  );
}

/* ── The window has closed (§7) ───────────────────────────────────────────── */

function Expired({
  state,
  className,
  onDismiss,
}: {
  state: StreakState;
  className?: string;
  onDismiss?: () => void;
}) {
  /*
    The flame that went out is the one worth showing — `longestStreak` is the
    only field that still remembers how far they got, because `applyActivity`
    overwrites `currentStreak` with 1 the moment a break is banked.
  */
  const tier = tierFor(state.longestStreak);
  return (
    <section className={cn("streak-recover", className)} aria-labelledby="streak-expired-title">
      <div className="flex items-center gap-3">
        <BrokenFlame tier={tier} />
        <div className="min-w-0 flex-1">
          <h3 id="streak-expired-title" className="streak-recover-eyebrow">
            Your next streak starts here
          </h3>
          <p className="streak-recover-head">
            {/* 🔴 NOT "you have no streak". Coming back today already restarted
                one, and telling them otherwise would be a fabricated setback. */}
            {state.currentStreak > 0
              ? `Day ${state.currentStreak} is already on the board.`
              : "Download something today to light it again."}
          </p>
        </div>
      </div>
      <p className="streak-recover-body streak-recover-keep">
        {/* The reassurance §6 asks for, said where the doubt actually occurs. */}
        Every flame you have unlocked is yours permanently.
      </p>
      <button
        type="button"
        onClick={() => onDismiss?.()}
        className="streak-recover-cta streak-recover-cta-quiet"
      >
        Start new streak
      </button>
    </section>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

/**
 * The flame, gone out: desaturated, dimmed, and with its rank motion switched
 * off (`effects={false}`) so it visibly stops living. Still recognisably the
 * same flame — §5's rule for locked tiers applies here for the same reason.
 */
function BrokenFlame({ tier }: { tier: ReturnType<typeof tierFor> }) {
  return (
    <span className="streak-recover-flame streak-recover-flame-out">
      <StreakFlameMark tier={tier} effects={false} className="h-8 w-8" wrapperClassName="h-9 w-9" />
    </span>
  );
}

/**
 * "23h 47m", ticking.
 *
 * 🔴 It counts down to a SERVER instant. The subtraction happens against the
 * device clock, which is the only clock a browser has — so this is a label, and
 * `canRestore` (server-side) remains the thing that decides. A device set
 * forward shows 0 and the button still works; a device set back shows a longer
 * number and the server still refuses. Neither can manufacture a restore.
 */
function useCountdown(expiresAt: string | null): string | null {
  const [, force] = useState(0);

  useEffect(() => {
    if (!expiresAt) return;
    const id = window.setInterval(() => force((n) => n + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const target = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(target)) return null;
  const ms = target - Date.now();
  if (ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  // Under an hour, "0h 12m" reads as broken; the hours are dropped instead.
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${Math.max(1, minutes)}m`;
}

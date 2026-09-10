"use client";

import { AlertTriangle, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { listAiJobs } from "@/lib/ai/client";
import { AI_JOB_STARTED_EVENT, browserHasUsedAiClean } from "@/lib/ai/history-cache";
import { aiNotificationCopy, outcomeForErrorCode } from "@/lib/ai/notification-copy";
import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "YOUR VIDEO IS READY" — anywhere in the app, with sound
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "make the notification when the ai video completed to be
 * push notification to the user and if the user is in the app or any pages it
 * be show a visible in page push with sound."
 *
 * ── 🔴 THE PUSH HALF ALREADY EXISTED, AND IT IS WHY THIS IS NEEDED ──────────
 *
 * `lib/ai/notify.ts` has sent a web push on completion since Part 4. But
 * `public/sw/push.js` deliberately SUPPRESSES the system notification when any
 * window client is visible, on a standing rule from 2026-07-16: "send push
 * notification if they are not in the app and when they are in the app, dont
 * send a push notification rather send a premium drop down notification."
 *
 * That rule is right, and it left a hole here. The in-app drop-down it defers
 * to (`NotificationLiveToast`) is driven by a realtime INSERT on the
 * `notifications` table, and it is mounted in `app/(app)/layout.tsx` — so:
 *
 *   · on `/ai`, `/ai/clean`, `/ai/history` and every other marketing route,
 *     that component does not exist at all;
 *   · a GUEST has no `notifications` row to insert, because
 *     `notifyAiCleanFinished` needs a user id and a guest has none.
 *
 * Put together: a member sitting on the AI page — the single most likely place
 * to be when their video lands — got NEITHER the push (suppressed, app is
 * visible) NOR the drop-down (not mounted here). Silence, from a delivery the
 * server correctly reported as sent. This closes that.
 *
 * ── 🔴 IT COSTS NOTHING WHEN NOTHING IS RUNNING ─────────────────────────────
 *
 * This mounts on every page, so its idle cost is the only thing that matters.
 * It makes ONE request on mount and then, if nothing is active, never runs
 * again: no interval is created, no listener beyond a single `visibilitychange`
 * one. The poll starts only once a job is genuinely in flight and stops the
 * moment it is not.
 *
 * That is also why it does not use Supabase Realtime. A channel is a websocket
 * held open on every page of the site for an event most visitors will never
 * receive — and this project has a hard-won rule that a realtime topic is a
 * global key, so a second subscriber on the same topic throws. A bounded poll
 * that only exists while work is happening is the cheaper and safer shape.
 *
 * ⚠️ It also stops while the tab is hidden. A hidden tab is exactly the case
 * the SYSTEM push is for, so polling there would be paying for a duplicate.
 *
 * ── 🔴 NO framer-motion, AND THAT IS A HARD CONSTRAINT ──────────────────────
 *
 * `NotificationLiveToast` animates with framer-motion, and copying it here
 * would have been the obvious thing to do. It would also have pulled framer-
 * motion into the LANDING PAGE's initial bundle, because this component mounts
 * in the marketing layout — and this project holds a 1.6s / 275 KiB budget for
 * that page with "no framer-motion" written into it explicitly.
 *
 * The animation is one element sliding down and fading in. A CSS transition on
 * `transform` and `opacity` does that on the compositor, costs no bytes, and
 * honours `prefers-reduced-motion` through the same `motion-reduce` utility
 * every other surface here uses.
 */

/** How often to ask, while a job is genuinely running. */
const POLL_MS = 12_000;

/** How long the banner stays before it retires itself. */
const VISIBLE_MS = 9_000;

type Alert = { job: AiJobView; kind: "ready" | "failed" };

export function AiJobAlert() {
  const router = useRouter();
  const [alert, setAlert] = useState<Alert | null>(null);
  /**
   * The transition's second frame.
   *
   * 🔴 A CSS transition needs a starting style that was actually painted. Both
   * states set in one paint produce no animation at all — the banner just
   * appears in place. `shown` is flipped from a `requestAnimationFrame` after
   * the element exists, which is the frame the browser can transition from.
   */
  const [shown, setShown] = useState(false);

  /*
    The ids we are currently watching. A job only produces a banner if we SAW
    it active first — otherwise opening the app an hour later would announce a
    video that finished last night as though it had just landed.
  */
  const watching = useRef<Set<string>>(new Set());
  /** Announced once, ever, per mount. Stops a re-poll re-firing the sound. */
  const announced = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    /*
      Slide out, THEN unmount. Removing the node immediately would make it
      vanish rather than leave — and the exit is the half people notice, because
      it happens while they are looking at it.
    */
    setShown(false);
    hideTimer.current = setTimeout(() => setAlert(null), 300);
  }, []);

  /* Paint the closed state first, then open, on the frame after mount. */
  useEffect(() => {
    if (!alert) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [alert]);

  useEffect(() => {
    let cancelled = false;

    const announce = (job: AiJobView) => {
      if (announced.current.has(job.id)) return;
      announced.current.add(job.id);

      /*
        ── 🔴 NOT WHILE THE WORKSPACE IS ALREADY SHOWING IT ──────────────────

        `/ai/clean` and `/studio/ai/clean` run their own state machine and paint
        the finished video with a reveal animation. A banner announcing "your
        video is ready" on top of the video, which is already on screen, is the
        same thing said twice — the exact duplication the push service worker
        avoids by suppressing itself when a window is visible.

        The sound still plays. That is deliberate: somebody on the workspace
        with the tab in the background hears the arrival, comes back, and the
        result is simply there. It is the visual half that would be redundant.
      */
      const onWorkspace = /\/ai\/clean(\/|$|\?)/.test(window.location.pathname + window.location.search);
      const kind: Alert["kind"] = job.status === "completed" ? "ready" : "failed";

      /*
        🔴 SOUND ONLY FOR THE GOOD NEWS. A tone that also fires on failure
        teaches somebody to flinch at it, and a job that did not finish already
        refunds the allowance and says so in the banner — it does not need to
        be announced across the room. `playSound` is best-effort and silent
        when the member has sounds off or the audio context was never unlocked
        by a gesture.
      */
      if (kind === "ready") {
        playSound("ai-ready");
        haptic("medium");
      }

      /*
        🔴 Tell the dashboard its numbers are stale. A finished job has just
        spent either a free slot or real money, and the panel showing that
        balance may be on screen behind this banner — polling it would be the
        battery rule broken for a number that changes twice a day, so the one
        component that KNOWS a job ended says so instead.
      */
      window.dispatchEvent(new Event("frenz-ai:job-finished"));

      if (onWorkspace) return;

      // Mounted closed; the effect above opens it on the next frame so the
      // transition has a painted state to start from.
      setShown(false);
      setAlert({ job, kind });
      if (hideTimer.current) clearTimeout(hideTimer.current);
      // Retire it the same way a tap does, so it always leaves by sliding out.
      hideTimer.current = setTimeout(() => {
        setShown(false);
        hideTimer.current = setTimeout(() => setAlert(null), 300);
      }, VISIBLE_MS);
    };

    const tick = async () => {
      timer.current = null;
      if (cancelled || document.visibilityState !== "visible") return;

      const res = await listAiJobs({ feature: "ai_clean", limit: 5 });
      if (cancelled || !res.ok) {
        // A failed poll is not a finished job. Keep watching if we were.
        if (watching.current.size > 0) schedule();
        return;
      }

      const jobs = res.jobs;
      const stillActive = new Set<string>();

      for (const job of jobs) {
        if (isActiveStatus(job.status)) {
          stillActive.add(job.id);
          watching.current.add(job.id);
          continue;
        }
        /*
          🔴 ONLY A JOB WE WATCHED GO ACTIVE. This is what separates "your video
          just finished" from "here is a video from yesterday". On the very
          first poll `watching` is empty, so a finished job found there is
          history and is deliberately ignored.
        */
        if (watching.current.has(job.id)) {
          watching.current.delete(job.id);
          if (job.status === "completed" || job.status === "failed") announce(job);
        }
      }

      // Anything we were watching that has vanished from the page entirely is
      // dropped rather than watched forever.
      for (const id of watching.current) {
        if (!stillActive.has(id)) watching.current.delete(id);
      }

      if (stillActive.size > 0) schedule();
    };

    const schedule = () => {
      if (timer.current || cancelled) return;
      timer.current = setTimeout(() => void tick(), POLL_MS);
    };

    /*
      ── 🔴 THE FIRST LOOK IS GATED, AND THE LANDING PAGE IS WHY ─────────────

      This component mounts in the marketing layout, so an ungated request on
      mount would hit `/api/ai/jobs` — `force-dynamic`, rate-limited — on every
      single visit to `/`, for a question whose answer is "nothing" for almost
      everyone. Including the AdSense crawler, on the page being assessed, on a
      page with a 1.6-second budget.

      `browserHasUsedAiClean()` is a `localStorage` key check: no parse, no
      network. A browser that has never touched AI Clean does nothing at all
      here — not one request, not one timer.
    */
    if (browserHasUsedAiClean()) void tick();

    /*
      And the first-timer, who by definition has no cache. `useAiCleanJob`
      fires this the moment a job is submitted, which is the exact case the
      gate above cannot see — and the case where somebody is most likely to be
      watching for the result.
    */
    const onStarted = () => void tick();
    window.addEventListener(AI_JOB_STARTED_EVENT, onStarted);

    /*
      Coming back to the tab restarts the loop. While hidden the loop stops (the
      system push covers that case), so without this a member who switched away
      and came back would sit on a stale page until they navigated.
    */
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(AI_JOB_STARTED_EVENT, onStarted);
      if (timer.current) clearTimeout(timer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const open = () => {
    if (!alert) return;
    haptic("selection");
    dismiss();
    router.push(`/ai/history?job=${encodeURIComponent(alert.job.id)}`);
  };

  const ready = alert?.kind === "ready";
  /*
    The same sentence the push would have used. Built here rather than stored on
    the alert so it always reflects the current copy module — and so a job whose
    error code arrives late still reads correctly.
  */
  const copy = alert
    ? aiNotificationCopy({
        feature: alert.job.feature,
        outcome: ready ? "completed" : outcomeForErrorCode(alert.job.error?.code),
        durationMs: alert.job.durationMs,
      })
    : null;

  return (
    /*
      🔴 TOP CENTRE, and the same offset as `NotificationLiveToast`. Two
      different banners appearing in two different places for two kinds of "we
      finished something" would read as two different products. z-80 matches it
      too, so neither can cover the other.

      `pointer-events-none` on the frame with `pointer-events-auto` on the card:
      the strip spans the width of the screen, and a full-width invisible layer
      that swallows taps at the top of every page is a bug nobody would connect
      back to this component.
    */
    <div className="pointer-events-none fixed inset-x-0 top-[calc(0.75rem+var(--frenz-safe-top))] z-[80] flex justify-center px-3">
      {alert && copy ? (
          <div
            key={alert.job.id}
            /*
              `shown` flips one frame after mount, so the browser has a starting
              style to transition FROM. Setting both states in the same paint
              gives no animation at all — the element simply appears in its
              final position, which is the bug this pattern exists to avoid.
            */
            className={cn(
              "pointer-events-auto flex w-full max-w-sm transform-gpu items-center gap-3",
              "rounded-3xl border border-border/70 bg-card p-3 text-left shadow-elevated",
              "transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
              shown ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0",
            )}
            style={{ willChange: "transform, opacity" }}
            role="status"
            aria-live="polite"
          >
            <button
              type="button"
              onClick={ready ? open : dismiss}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                  ready
                    ? "bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500 text-white"
                    : "bg-amber-500/12 text-amber-600 dark:text-amber-400",
                )}
              >
                {ready ? <Sparkles className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                {/*
                  ── 🔴 THE SAME WORDS THE PUSH USES ──────────────────────────

                  `aiNotificationCopy` is the one place this product decides
                  what a finished job says. Written separately here, the banner
                  and the lock screen would drift within a week — and nobody
                  would notice, because the two are never on screen together.

                  The FILENAME still wins on a ready job when there is one: on
                  this surface the member is looking at their own library, and
                  "okkurrr.mp4 is ready" identifies which video far better than
                  a generic sentence can. The copy is the fallback, not the
                  exception.
                */}
                <span className="block truncate text-sm font-semibold leading-snug">{copy.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {ready ? (alert.job.source.name ?? copy.body) : copy.body}
                </span>
              </span>
            </button>

            {/*
              A real dismiss. This appears over whatever somebody was doing, so
              it must be closable immediately rather than only by waiting or by
              navigating away from the page they chose to be on.
            */}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
      ) : null}
    </div>
  );
}

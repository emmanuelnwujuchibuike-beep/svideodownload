"use client";

import { Check, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Portal } from "@/components/ui/portal";
import {
  dismissGeneration,
  getServerSnapshot,
  getSnapshot,
  restoreActiveGeneration,
  subscribe,
} from "@/features/ai/video/active-generation";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE GENERATION CARD — it outlives the page that started it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-04: "the progress card must SURVIVE leaving the page, and
 * show 'completed — view' if it finishes while I'm on it."
 *
 * It reads `active-generation.ts`, which is module state plus `sessionStorage`
 * — so walking from Text to Video to the history page, or reloading, keeps
 * both the card and the watch. Nothing about the generation lives in this
 * component; it renders what the store says and offers two buttons.
 *
 * ── 🔴 PORTALLED, AND THAT IS A LAW HERE, NOT A PREFERENCE ─────────────────
 *
 * `position: fixed` does not resolve against the viewport when ANY ancestor
 * carries `transform`, `filter`, `backdrop-filter` or `will-change`. The AI
 * surfaces are full of all four (the ambient wash, the glass cards), and
 * `page-transition.tsx` transforms its wrapper for the whole of every
 * navigation and every back-swipe frame. A non-portalled card would be pinned
 * to a box sliding across the screen — the "unprofessional square" this
 * project hit three times in one day. See `components/ui/portal.tsx`.
 *
 * ── Where it sits, and why not bottom-right ────────────────────────────────
 *
 * `FloatingDownloadProgress` docks bottom-right on desktop and full-width at
 * the bottom on a phone. A download and a generation can easily be running at
 * once, so this stacks one card-height ABOVE it rather than on top of it —
 * the same reasoning the wallpaper upload pill uses to choose bottom-left.
 *
 * ── No framer-motion ───────────────────────────────────────────────────────
 *
 * One element fading and sliding in. A CSS transition does that on the
 * compositor for no bytes, and `motion-reduce` turns it off — the house rule
 * every other surface here follows.
 */
export function AiGenerationProgressCard() {
  const gen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [shown, setShown] = useState(false);

  // Pick up a generation started on another page, once.
  useEffect(() => {
    restoreActiveGeneration();
  }, []);

  /*
    The transition's second frame. A CSS transition needs a starting style that
    was actually painted; both states set in one paint produce no animation at
    all. Same approach as `ai-job-alert.tsx`.
  */
  const visible = !!gen && !gen.dismissed;
  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [visible]);

  if (!gen || gen.dismissed) return null;

  const running = gen.phase === "running";
  const done = gen.phase === "completed";

  return (
    <Portal>
      <div
        className={cn(
          // One card-height above the downloads card, on both layouts.
          "fixed inset-x-3 bottom-[calc(10.25rem+env(safe-area-inset-bottom))] z-[86] mx-auto max-w-md",
          "lg:inset-x-auto lg:bottom-[7.5rem] lg:right-6 lg:w-96",
          "transition duration-300 [transition-timing-function:var(--ease-out)] motion-reduce:transition-none",
          shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/95 p-3 shadow-elevated backdrop-blur-xl">
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-full",
              done ? "bg-emerald-500/15 text-emerald-600" : gen.phase === "failed" ? "bg-rose-500/15 text-rose-600" : "bg-violet-500/15 text-violet-600",
            )}
          >
            {done ? <Check className="h-5 w-5" aria-hidden /> : <Sparkles className="h-5 w-5" aria-hidden />}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold">
              {done ? "Your video is ready" : gen.phase === "failed" ? "That generation didn't finish" : "Making your video"}
            </p>
            {/*
              The member's own words when there are some, the error when it
              failed. Never a percentage: Kling reports `submitted / processing
              / succeeded / failed` and nothing between, so a number here would
              be invented.
            */}
            <p className="truncate text-[12px] text-muted-foreground">
              {gen.phase === "failed" ? gen.error : gen.label || "This keeps going if you leave the page."}
            </p>
            {running ? (
              <span aria-hidden className="mt-1.5 block h-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                <span className="frenz-ai-indeterminate block h-full w-1/3 rounded-full bg-violet-500/70" />
              </span>
            ) : null}
          </div>

          {done ? (
            <Link
              href={gen.href}
              onClick={() => dismissGeneration()}
              className="shrink-0 rounded-full bg-foreground px-3.5 py-2 text-[12.5px] font-semibold text-background transition active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              View
            </Link>
          ) : null}

          {/*
            🔴 A RUNNING generation cannot be dismissed, and the reason is the
            promise the card makes. Closing it would read as "stop that", and
            nothing here can stop it — the job is server-side and already paid
            for. So the close button appears only once there is nothing left to
            watch.
          */}
          {!running ? (
            <button
              type="button"
              onClick={() => dismissGeneration()}
              aria-label="Dismiss"
              className="shrink-0 rounded-full p-1.5 text-muted-foreground transition hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}

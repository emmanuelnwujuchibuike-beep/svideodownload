"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { glass, layer, reelMotion } from "./design";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SOCIAL PULSE™ (Feature 15, Part 1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "While watching a reel, users can optionally see lightweight social updates —
 *  Emma liked this, David reposted this, trending among your friends, Grace
 *  commented. They appear briefly, fade away smoothly, and never interrupt
 *  playback. Users can disable Social Pulse in Settings."
 *
 * ── The line this feature has to stay on the right side of ─────────────────
 *
 * A card that appears over a video someone is watching is an INTERRUPTION by
 * default. Everything here exists to make it ambient instead:
 *
 *  • It never takes focus, never traps it, and is not a live region that
 *    interrupts a screen reader mid-sentence (`aria-live="polite"`, and see the
 *    note below on why it is not `off`).
 *  • It never accepts a tap. There is no action to miss, so there is nothing to
 *    lose by ignoring it — which is what makes it safe to show at all.
 *  • One at a time, bottom-left, clear of the action rail and the caption.
 *  • It stops entirely while the video is paused: a paused video usually means
 *    the person is reading the caption or deciding something, and that is the
 *    worst possible moment to slide a card in.
 *
 * ── Honest data only ───────────────────────────────────────────────────────
 *
 * 🔴 This renders ONLY events the caller actually has. It fabricates nothing —
 * no "trending" without a real signal, no invented names. This codebase has a
 * standing rule against fabricated social proof (the Reality Ledger fails the
 * build on scale claims, and invented engagement has been declined three times).
 * A Pulse with no events renders nothing at all, which is the correct empty
 * state and is what most reels will show.
 *
 * ── The preference is real, and it defaults ON ─────────────────────────────
 *
 * Stored in localStorage so it applies before any network call and works signed
 * out. Read through a function rather than at module scope so it cannot be
 * baked into a prerendered bundle.
 */

export type PulseKind = "like" | "repost" | "comment" | "trending";

export interface PulseEvent {
  id: string;
  kind: PulseKind;
  /** Display name of the actor. Omitted for `trending`, which has no actor. */
  actor?: string;
}

const PREF_KEY = "frenz:reels:social-pulse";

/** Default ON — the feature is opt-OUT, per the spec's "users can disable". */
export function socialPulseEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    // Storage blocked (private mode, embedded webview) — fall back to the
    // default rather than to off, so the feature is not silently missing.
    return true;
  }
}

export function setSocialPulseEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* nothing we can do, and nothing that should throw into a click handler */
  }
}

/**
 * The glyph and wording for each kind.
 *
 * Wording is deliberately past-tense and terse — "Emma liked this" not "Emma has
 * just liked this reel". The card is on screen for a few seconds over moving
 * video; every extra word is one the reader will not finish.
 */
function describe(e: PulseEvent): { glyph: string; text: string } | null {
  switch (e.kind) {
    case "like":
      return e.actor ? { glyph: "💙", text: `${e.actor} liked this` } : null;
    case "repost":
      return e.actor ? { glyph: "🔁", text: `${e.actor} reposted this` } : null;
    case "comment":
      return e.actor ? { glyph: "💬", text: `${e.actor} commented` } : null;
    case "trending":
      return { glyph: "⭐", text: "Trending among your friends" };
    default:
      return null;
  }
}

/** How long a single card stays up. */
const SHOW_MS = 3400;
/** Quiet gap between cards, so two events never read as a stream of alerts. */
const GAP_MS = 2600;
/** Nothing appears until the viewer has settled into the clip. */
const LEAD_IN_MS = 2000;

export function SocialPulse({
  events,
  /** Only the active, PLAYING card pulses. */
  active,
  className,
}: {
  events: PulseEvent[];
  active: boolean;
  className?: string;
}) {
  const [index, setIndex] = useState(-1);
  const [enabled, setEnabled] = useState(false);

  // Read the preference on the client only — this component renders inside a
  // deck that is server-rendered, and touching localStorage during render would
  // produce a hydration mismatch.
  useEffect(() => setEnabled(socialPulseEnabled()), []);

  useEffect(() => {
    if (!enabled || !active || events.length === 0) {
      setIndex(-1);
      return;
    }
    let i = -1;
    let timer: ReturnType<typeof setTimeout>;

    const next = () => {
      i += 1;
      if (i >= events.length) {
        // Deliberately does NOT loop. Repeating the same three notifications for
        // as long as someone watches turns ambient into nagging.
        setIndex(-1);
        return;
      }
      setIndex(i);
      timer = setTimeout(() => {
        setIndex(-1);
        timer = setTimeout(next, GAP_MS);
      }, SHOW_MS);
    };

    timer = setTimeout(next, LEAD_IN_MS);
    return () => clearTimeout(timer);
  }, [enabled, active, events]);

  const current = index >= 0 ? events[index] : undefined;
  const shown = current ? describe(current) : null;

  return (
    <div
      className={cn("pointer-events-none absolute", layer.pulse, className)}
      /*
        `polite`, not `off`.

        The instinct is to hide this from screen readers entirely as decoration.
        But it is not decoration — it is real information about real people, and
        a sighted user gets it. `polite` waits for a pause in speech, so it
        informs without ever cutting across what is being read.
      */
      aria-live="polite"
      aria-atomic="true"
    >
      <AnimatePresence mode="wait">
        {shown ? (
          <motion.div
            key={current!.id}
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={reelMotion.pulse}
            className={cn(
              "flex max-w-[15rem] items-center gap-2 rounded-full px-3 py-1.5",
              glass.ambient,
            )}
          >
            <span aria-hidden className="text-[13px] leading-none">
              {shown.glyph}
            </span>
            <span className="truncate text-[12px] font-semibold leading-tight text-white/90">
              {shown.text}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { layer } from "./design";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREMIUM VIDEO PROGRESS (Feature 15, Part 1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Replace traditional progress bars. Rounded ends, gradient fill, smooth
 *  motion, buffered progress, live position, gesture seeking."
 *
 * ── What this changes from the bar it replaces ─────────────────────────────
 *
 * The previous bar had the gradient and the drag-to-seek already. Three things
 * it did not have, and each is in the brief:
 *
 *  1. BUFFERED PROGRESS. It showed played-vs-nothing, so a stalled clip and a
 *     fully-downloaded paused one looked identical. The buffered range is read
 *     from the element's own `TimeRanges` — the browser already knows it — and
 *     drawn as a third tone between the track and the fill. On a slow connection
 *     this is the difference between "it is loading" and "it is broken", which
 *     is the single most valuable thing a progress bar can communicate.
 *
 *  2. ROUNDED ENDS, on BOTH ends. It was `rounded-r-full` on the fill only, so
 *     at 0% the bar had a square left edge butting into the screen corner. The
 *     track is now fully rounded and the fill is clipped by it, which is also
 *     why the fill needs no radius of its own.
 *
 *  3. A REAL TOUCH TARGET. The visible bar is 3px; the interactive row is 20px.
 *     A 3px drag target fails WCAG 2.5.8 outright and is genuinely hard to hit
 *     while holding a phone one-handed. The hit area is padding around the
 *     visual, not a bigger bar.
 *
 * ── Why it reads the element instead of taking props ───────────────────────
 *
 * Progress is the one piece of state that changes ~30 times a second. Lifting it
 * into React state in the card means re-rendering the entire reel — rail,
 * caption, everything — on every tick. Here the component owns a `timeupdate`
 * subscription and writes the fill through a ref, so a position change costs one
 * style mutation and NO React render at all.
 *
 * ── Keyboard ──────────────────────────────────────────────────────────────
 *
 * It is a real `slider` with arrow-key seeking. The previous bar was a bare div
 * with pointer handlers, so seeking was mouse/touch only — invisible to keyboard
 * and to switch access. The ARIA values are in SECONDS with a human
 * `aria-valuetext`, because "37 of 118" is meaningless read aloud and "0:37 of
 * 1:58" is not.
 */

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function ReelProgress({
  video,
  /** Chrome visibility — the bar follows the rest of the UI. */
  visible,
  /** Seeking is only offered when we own a real <video> with a known duration. */
  seekable = true,
  className,
  onSeekStart,
  onSeekEnd,
}: {
  video: HTMLVideoElement | null;
  visible: boolean;
  seekable?: boolean;
  className?: string;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
}) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const bufferRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLSpanElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubPct, setScrubPct] = useState(0);
  // Duration is the ONLY thing kept in React state — it changes once per clip,
  // and the ARIA attributes need it. Position deliberately is not.
  const [duration, setDuration] = useState(0);

  /*
    Position + buffered, written straight to the DOM.

    `timeupdate` fires ~4x/second and `progress` fires as data arrives. Both are
    handled here without setState, so a playing video re-renders nothing.
  */
  useEffect(() => {
    if (!video) return;
    let raf = 0;

    const paint = () => {
      raf = 0;
      const d = video.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      const pct = Math.min(100, Math.max(0, (video.currentTime / d) * 100));
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (knobRef.current) knobRef.current.style.left = `${pct}%`;

      // Buffered: the range that CONTAINS the playhead, not simply the last one.
      // A seek can leave several disjoint ranges, and drawing the wrong one shows
      // a full bar for data that is nowhere near where you are watching.
      try {
        const b = video.buffered;
        let end = 0;
        for (let i = 0; i < b.length; i++) {
          if (b.start(i) <= video.currentTime && video.currentTime <= b.end(i)) {
            end = b.end(i);
            break;
          }
        }
        if (bufferRef.current) {
          bufferRef.current.style.width = `${Math.min(100, (end / d) * 100)}%`;
        }
      } catch {
        /* `buffered` can throw on a detached/reset element — the bar just
           keeps its last value, which is harmless. */
      }
    };

    const schedule = () => {
      // Coalesced to a frame: `timeupdate` and `progress` can both fire between
      // paints, and there is no value in writing the same style twice.
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onMeta = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      schedule();
    };

    video.addEventListener("timeupdate", schedule);
    video.addEventListener("progress", schedule);
    video.addEventListener("seeking", schedule);
    video.addEventListener("seeked", schedule);
    video.addEventListener("loadedmetadata", onMeta);
    onMeta();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      video.removeEventListener("timeupdate", schedule);
      video.removeEventListener("progress", schedule);
      video.removeEventListener("seeking", schedule);
      video.removeEventListener("seeked", schedule);
      video.removeEventListener("loadedmetadata", onMeta);
    };
  }, [video]);

  const canSeek = seekable && duration > 0 && !!video;

  const pctFromEvent = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const start = (e: React.PointerEvent) => {
    if (!canSeek) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setScrubbing(true);
    setScrubPct(pctFromEvent(e.clientX));
    onSeekStart?.();
  };
  const move = (e: React.PointerEvent) => {
    if (!scrubbing) return;
    setScrubPct(pctFromEvent(e.clientX));
  };
  const end = (e: React.PointerEvent) => {
    if (!scrubbing) return;
    const p = pctFromEvent(e.clientX);
    setScrubbing(false);
    if (video && duration > 0) video.currentTime = p * duration;
    onSeekEnd?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!video || duration <= 0) return;
    // 5s steps, 10% on PageUp/Down — the same vocabulary as a native player, so
    // nobody has to learn ours.
    const step = e.shiftKey ? 10 : 5;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = video.currentTime + step;
    else if (e.key === "ArrowLeft") next = video.currentTime - step;
    else if (e.key === "PageUp") next = video.currentTime + duration * 0.1;
    else if (e.key === "PageDown") next = video.currentTime - duration * 0.1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = duration;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    video.currentTime = Math.min(duration, Math.max(0, next));
  };

  const displayPct = scrubbing ? scrubPct * 100 : undefined;

  return (
    /*
      🔴 BOTTOM, not top (owner, 2026-08-10: "when you enter the reels part, move
      the progress bar to the bottom").

      It sat under the safe-area at the TOP, which is where this player has always
      put it — and the owner is right that the bottom is the better home. Three
      reasons it holds up beyond preference:

      • REACH. Seeking is a drag gesture, and the bottom of the screen is inside
        the thumb arc while the top is the least reachable strip on a tall phone.
        This is the same argument as the Adaptive Action Rail™, applied to the one
        control that is explicitly draggable.

      • CONVENTION. Every video player a person has ever used puts the timeline at
        the bottom edge. The top strip is where a status bar and a tab bar live,
        and this one was competing with both.

      • IT STOPS FIGHTING THE TABS. At the top it shared `--frenz-safe-top` with
        the For You/Following nav and the album dots, so three things stacked into
        the one region the notch already eats.

      `bottom` is offset by the caller through `className` (the page variant has a
      bottom nav to clear, the modal does not) with `env(safe-area-inset-bottom)`
      as the floor, so it never lands under the home indicator.
    */
    <div
      className={cn(
        "absolute inset-x-0 bottom-[max(0.5rem,env(safe-area-inset-bottom))] px-3 transition-opacity duration-200",
        layer.progress,
        visible || scrubbing ? "opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
    >
      <div
        ref={trackRef}
        role={canSeek ? "slider" : undefined}
        tabIndex={canSeek ? 0 : undefined}
        aria-label={canSeek ? "Seek video" : undefined}
        aria-valuemin={canSeek ? 0 : undefined}
        aria-valuemax={canSeek ? Math.round(duration) : undefined}
        aria-valuenow={canSeek ? Math.round(video?.currentTime ?? 0) : undefined}
        aria-valuetext={canSeek ? `${fmt(video?.currentTime ?? 0)} of ${fmt(duration)}` : undefined}
        onPointerDown={canSeek ? start : undefined}
        onPointerMove={canSeek ? move : undefined}
        onPointerUp={canSeek ? end : undefined}
        onPointerCancel={canSeek ? end : undefined}
        onKeyDown={canSeek ? onKeyDown : undefined}
        className={cn(
          // 20px interactive row around a 3px visual — see the note on WCAG
          // 2.5.8. `touch-none` so a horizontal drag seeks instead of the deck
          // interpreting it as a swipe.
          "group/seek relative flex items-center outline-none",
          canSeek ? "h-5 cursor-pointer touch-none" : "h-2",
          "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-0",
        )}
      >
        {/* TRACK — fully rounded, and it CLIPS the two bars inside it, which is
            what gives the fill rounded ends at both ends for free. */}
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-150",
            scrubbing ? "h-[5px]" : "h-[3px] group-hover/seek:h-[5px]",
          )}
        >
          {/* BUFFERED — between track and fill. Deliberately low-contrast: it is
              reassurance, not information you act on. */}
          <div
            ref={bufferRef}
            aria-hidden
            className="absolute inset-y-0 left-0 bg-white/30"
            style={{ width: 0 }}
          />
          {/* PLAYED — the brand gradient, and the accent stop is the Living
              Interface™ colour when one has been sampled, so the bar is lit by
              the video. Falls back to the fixed violet when there is no tint. */}
          <div
            ref={fillRef}
            aria-hidden
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-400 via-[hsl(var(--reel-accent,265_85%_65%))] to-fuchsia-400"
            style={displayPct !== undefined ? { width: `${displayPct}%` } : undefined}
          />
        </div>

        {/* KNOB — only while seeking or hovering. A permanently visible knob on a
            3px bar is visual noise on top of a video. */}
        {canSeek ? (
          <span
            ref={knobRef}
            aria-hidden
            className={cn(
              "pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.5)] ring-2 ring-[hsl(var(--reel-accent,265_85%_65%))] transition-[opacity,transform] duration-150",
              scrubbing ? "scale-125 opacity-100" : "opacity-0 group-hover/seek:opacity-100",
            )}
            style={displayPct !== undefined ? { left: `${displayPct}%` } : undefined}
          />
        ) : null}

        {/* Scrub readout — only while dragging, so it never sits over the video
            during normal playback. */}
        {scrubbing ? (
          <span
            className="pointer-events-none absolute -top-9 -translate-x-1/2 rounded-lg bg-black/85 px-2 py-1 text-[11px] font-bold tabular-nums text-white shadow-lg ring-1 ring-inset ring-white/15"
            style={{ left: `${scrubPct * 100}%` }}
          >
            {fmt(scrubPct * duration)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

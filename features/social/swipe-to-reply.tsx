"use client";

import { Reply } from "lucide-react";
import { useRef, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Swipe a message right to reply to it (owner, 2026-10-22: "Make users to be able to reply to chat by
 * swiping right") — WhatsApp's gesture. The row follows the finger up to MAX_PULL, a reply arrow
 * fades in beside it, a light tick fires as it passes TRIGGER, and letting go past it calls `onReply`.
 *
 * 🔴 IT IS THE ROW, NOT A WRAPPER AROUND IT. The message row's 80% cap must resolve against the full
 * message column (see the long note in conversation-room.tsx — a shrink-to-fit parent collapses the
 * bubble to one character per line), so this renders the row element itself and takes its classes.
 *
 * ── Never in the way ─────────────────────────────────────────────────────────
 *   · `touch-action: pan-y` hands vertical scrolling to the browser; the gesture is only claimed once
 *     the finger has clearly moved sideways (more x than y, past a small slop);
 *   · a drag that starts at the screen's left edge is left alone — that is iOS's own swipe-back;
 *   · leftward drags do nothing; press-and-hold still opens the menu (a hold does not move);
 *   · a finished swipe never also counts as a tap on what was under the finger;
 *   · no React state per frame: the transform is written straight to the element.
 */

const TRIGGER = 56;
const MAX_PULL = 72;
const SLOP = 10;
const EDGE = 24;

export function SwipeToReply({ onReply, disabled, children, className }: { onReply: () => void; disabled?: boolean; children: ReactNode; className?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const claimed = useRef(false);
  const armed = useRef(false);
  const justSwiped = useRef(false);

  const paint = (dx: number, animate: boolean) => {
    const el = row.current;
    if (el) {
      el.style.transition = animate ? "transform 180ms ease-out" : "none";
      el.style.transform = dx ? `translate3d(${dx}px,0,0)` : "";
    }
    if (icon.current) {
      const k = Math.min(1, dx / TRIGGER);
      icon.current.style.opacity = String(k);
      icon.current.style.transform = `scale(${0.6 + 0.4 * k})`;
    }
  };

  const end = (fire: boolean) => {
    if (claimed.current) {
      justSwiped.current = true;
      window.setTimeout(() => (justSwiped.current = false), 0);
    }
    start.current = null;
    claimed.current = false;
    armed.current = false;
    paint(0, true);
    if (fire) onReply();
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.pointerType === "mouse" || e.clientX < EDGE) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!claimed.current) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
        start.current = null; // a scroll — not ours
        return;
      }
      if (dx < SLOP) return;
      claimed.current = true;
      row.current?.setPointerCapture?.(e.pointerId);
    }
    // resistance past the trigger, so it reads as a pull rather than a slide
    const d = Math.max(0, dx);
    const pull = d <= TRIGGER ? d : Math.min(MAX_PULL, TRIGGER + (d - TRIGGER) * 0.35);
    if (pull >= TRIGGER && !armed.current) {
      armed.current = true;
      try {
        navigator.vibrate?.(10);
      } catch {
        /* no haptics here */
      }
    } else if (pull < TRIGGER) armed.current = false;
    paint(pull, false);
  };

  return (
    <div
      ref={row}
      className={cn("relative touch-pan-y", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => end(claimed.current && armed.current)}
      onPointerCancel={() => end(false)}
      onClickCapture={(e) => {
        if (!justSwiped.current) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <span ref={icon} aria-hidden className="pointer-events-none absolute -left-10 top-1/2 -mt-4 flex h-8 w-8 items-center justify-center rounded-full bg-frenz-ink/10 text-frenz-ink opacity-0">
        <Reply className="h-4 w-4" />
      </span>
      {children}
    </div>
  );
}

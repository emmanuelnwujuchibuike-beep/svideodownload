"use client";

import { MessageCircle, PartyPopper, X } from "lucide-react";
import type { CSSProperties } from "react";

import { Portal } from "@/components/ui/portal";

/**
 * Acceptance celebration (Friend Request spec): "You and {name} are now friends" with Start Chat first.
 *
 * Friends brief 2026-10-26 (no animation libraries, transform + opacity only, nothing looping): framer-motion
 * is gone. The card fades and scales in once (tailwindcss-animate), the light ring and the particles play
 * once (`frenz-burst`, globals.css) and stop; reduced motion shows the card with no movement at all. A solid
 * white card on a dim backdrop — no blur behind a full-screen layer.
 */
export function FriendCelebration({
  open,
  name,
  onStartChat,
  onClose,
}: {
  open: boolean;
  name: string;
  onStartChat: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  /* Portalled: a `fixed inset-0` overlay is clipped to any transformed, filtered or blurred ancestor, which
     several surfaces have. See components/ui/portal.tsx for the full explanation. */
  return (
    <Portal>
      <div
        className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4 animate-in fade-in duration-200 motion-reduce:animate-none"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={`You and ${name} are now friends`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="frenz-ui relative w-full max-w-sm overflow-hidden rounded-[28px] border border-frenz-line bg-frenz-card p-7 text-center shadow-[0_30px_60px_-24px_rgb(18_12_60/0.55)] animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300 motion-reduce:animate-none"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
            <span className="frenz-burst absolute left-1/2 top-[58px] -ml-20 -mt-20 h-40 w-40 rounded-full bg-frenz-gradient opacity-0" style={{ "--bx": "0px", "--by": "0px", "--bs": "2.2" } as CSSProperties} />
            {PARTICLES.map((p, i) => (
              <span
                key={i}
                className={`frenz-burst absolute left-1/2 top-[90px] h-2 w-2 rounded-full ${p.color}`}
                style={{ "--bx": `${p.x}px`, "--by": `${p.y}px`, "--bs": "0.4", animationDelay: "120ms" } as CSSProperties}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-frenz-muted transition-transform active:scale-[0.97]"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-frenz-gradient shadow-[0_14px_30px_-12px_rgb(91_63_240/0.6)] animate-in zoom-in-50 duration-300 motion-reduce:animate-none">
            <PartyPopper className="h-8 w-8 text-white" aria-hidden />
          </div>

          <h2 className="relative mt-4 font-heading text-[19px] font-bold tracking-[-0.3px]">You and {name} are now friends</h2>
          <p className="relative mt-1 text-[14px] text-frenz-muted">Say hello and start the conversation.</p>

          <div className="relative mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={onStartChat}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-[24px] bg-frenz-gradient-x font-heading text-[15px] font-bold text-white transition-transform active:scale-[0.97]"
            >
              <MessageCircle className="h-4 w-4" aria-hidden /> Start Chat
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-12 w-full rounded-[24px] border border-frenz-line bg-frenz-card text-[15px] font-semibold transition-transform active:scale-[0.97]"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

// brand colours only (the gradient's three stops)
const PARTICLES = [
  { x: -90, y: -70, color: "bg-frenz-blue" },
  { x: 90, y: -60, color: "bg-frenz-violet" },
  { x: -60, y: 70, color: "bg-frenz-magenta" },
  { x: 70, y: 80, color: "bg-frenz-blue" },
  { x: -110, y: 10, color: "bg-frenz-violet" },
  { x: 110, y: 0, color: "bg-frenz-magenta" },
  { x: 0, y: -95, color: "bg-frenz-violet" },
  { x: 20, y: 95, color: "bg-frenz-blue" },
];

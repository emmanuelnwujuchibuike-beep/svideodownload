"use client";

import { Gift } from "lucide-react";
import { useEffect, useState } from "react";

import { haptic } from "@/lib/motion/haptics";

import { coachDismissed, dismissCoach } from "./gift-prefs";

/*
  Frenz Gift Coin Part 6 — screen 1: the sticker-gift button in the chat composer, and the one-time "Send a sticker
  gift" coach mark above it.

  Beside the emoji button rather than in place of it (the design swaps them, but the emoji picker is a working feature
  of this composer — kept). Rendered by the room only where a gift can be sent at all (not a secret chat, someone to
  send to, sending allowed); whether stickers are published is learned when the sheet opens — the catalogue is never
  loaded just to draw a button. The coach mark shows once per device: dismissing it, or sending a gift, ends it for
  good (gift-prefs.ts — no server write, no tracking). It sits above the composer pill, never over the text field, and
  is a polite note, not a dialog: focus stays where the member put it.
*/
export function GiftComposerButton({ onOpen }: { onOpen: () => void }) {
  const [coach, setCoach] = useState(false);
  useEffect(() => {
    // after mount: storage is read on the client only, and a returning member never sees a flash of it
    if (!coachDismissed()) setCoach(true);
  }, []);
  const close = () => {
    dismissCoach();
    setCoach(false);
  };
  return (
    <span className="relative flex shrink-0">
      <button
        type="button"
        onPointerDown={() => void import("./gift-sheet")}
        onClick={() => {
          haptic("light");
          if (coach) close();
          onOpen();
        }}
        aria-label="Send a sticker gift"
        className="flex h-11 w-9 items-center justify-center text-frenz-ink/80 transition hover:text-frenz-ink active:scale-90"
      >
        <Gift size={20} strokeWidth={2} aria-hidden />
      </button>
      {coach ? (
        <span role="note" className="absolute bottom-[calc(100%+12px)] right-[-48px] z-20 flex w-[min(280px,calc(100vw-32px))] items-start gap-2 rounded-[18px] bg-frenz-gradient-x p-3 pr-2 text-left text-white shadow-frenz-card motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1">
          <span className="min-w-0 flex-1">
            <span className="inline-block rounded-full bg-white/25 px-1.5 py-px text-[10px] font-extrabold tracking-wide">NEW</span>
            <span className="mt-1 block text-[15px] font-bold">Send a sticker gift</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-white/90">Pick a sticker, pay with Gift Coins and it lands right in the chat.</span>
          </span>
          <button type="button" onClick={close} aria-label="Dismiss tip" className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white/20">
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
          <span aria-hidden className="absolute -bottom-1.5 right-[60px] h-3 w-3 rotate-45 bg-[hsl(var(--frenz-violet))]" />
        </span>
      ) : null}
    </span>
  );
}

"use client";

import { useState } from "react";

import type { CommentGift } from "@/lib/gift/comment-gifts";
import { cn } from "@/lib/utils";

import { fgcText } from "./gift-format";

/*
  A sticker gift in a post's comments (0304 — owner, 2026-10-28: "make gift sent from comment show in comment, not
  chat", then "the gift sticker should show in the comment sheet like a normal sticker but with a unique badge").
  So it is drawn the size and way of a comment sticker — the bare artwork, no card — with ONE thing no ordinary sticker
  has: the gradient gift badge (a ribbon glyph, the count, the Gift Coins it was worth). Everything comes from the gift's
  own record (the server resolves `gf:<gift id>` — lib/gift/comment-gifts-server.ts), never from anything typed.
  A tap replays the bounce.
*/
export function CommentGiftCard({ gift }: { gift: CommentGift }) {
  const [bounce, setBounce] = useState(0);
  const art = gift.animationUrl ?? gift.imageUrl;
  const count = Math.max(1, gift.quantity);
  return (
    <button
      type="button"
      onClick={() => setBounce((n) => n + 1)}
      aria-label={`Gift to ${gift.recipientName}: ${gift.name}${count > 1 ? `, ${count} times` : ""}, ${fgcText(gift.priceFgc * count)} Gift Coins`}
      className="relative mt-1 block w-fit pb-2.5"
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element -- the gifted sticker, from the gift's own snapshot
        <img
          key={bounce}
          src={art}
          alt=""
          className={cn("h-24 w-24 object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.18)]", bounce > 0 ? "motion-safe:animate-[gift-bounce_0.45s_ease-out]" : "origin-bottom motion-safe:animate-sticker")}
        />
      ) : (
        <span className="flex h-24 w-24 items-center justify-center text-5xl" aria-hidden>
          🎁
        </span>
      )}
      {/* the badge only a gift has */}
      <span className="absolute -bottom-0.5 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border-2 border-white bg-frenz-gradient-x py-0.5 pl-1.5 pr-2 text-[10.5px] font-extrabold text-white shadow-frenz-card dark:border-neutral-900">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="8" width="18" height="4" rx="1" />
          <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
        </svg>
        Gift{count > 1 ? ` ×${count}` : ""}
        <span className="font-semibold text-white/85">· {fgcText(gift.priceFgc * count)}</span>
      </span>
      <style>{"@keyframes gift-bounce{0%{transform:scale(1)}45%{transform:scale(1.15)}100%{transform:scale(1)}}"}</style>
    </button>
  );
}

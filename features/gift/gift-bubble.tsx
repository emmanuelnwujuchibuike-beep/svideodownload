"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

import { fgcText, RARITY_TAG, type Rarity } from "./gift-format";

/*
  Frenz Gift Coin Part 4 — a sticker gift in the chat (design/sticker-gifts.html screen 4: glass card, the sticker, the
  name, "You sent {name} a gift" / "{name} sent you a gift", a coin tag). Drawn from the message's metadata, which the
  server wrote from the gift record (messages_gift_guard refuses a gift message that doesn't match a real gift — and,
  from 0296, one that states another quantity or note than its own). An unknown or incomplete gift falls back to a
  plain "Sent a gift" card.

  Part 6: a send of several copies shows "×N"; the sender's note shows under the sticker, as plain text. The RECIPIENT's
  tap opens the full-screen reveal (screen 5) — as often as they like: it is a view of the stored gift, it writes
  nothing, so reopening it never touches a balance, a gift or a notification. Everyone else's tap replays the bounce.
*/

const GiftReveal = dynamic(() => import("./gift-reveal").then((m) => m.GiftReveal), { ssr: false });

export interface GiftMeta {
  giftId?: string;
  recipientId?: string;
  stickerId?: string;
  name?: string;
  imageUrl?: string | null;
  animationUrl?: string | null;
  rarity?: string;
  priceFgc?: number;
  /** Part 6 (0296): copies sent together, and the sender's note — both the database's own */
  quantity?: number;
  note?: string;
}

/**
 * The bubble's line. Part 5 fix: in a GROUP the other members are neither sender nor recipient — they read "{sender}
 * sent {recipient} a gift", never "…sent you a gift" (only the chosen recipient reads that).
 */
export function giftLine(meta: Pick<GiftMeta, "name" | "quantity">, mine: boolean, viewerIsRecipient: boolean, senderName: string, recipientName: string): string {
  if (!meta.name) return "Sent a gift";
  const what = (meta.quantity ?? 1) > 1 ? `${meta.quantity} gifts` : "a gift";
  if (mine) return `You sent ${recipientName} ${what}`;
  return viewerIsRecipient ? `${senderName} sent you ${what}` : `${senderName} sent ${recipientName} ${what}`;
}

export function GiftBubble({ meta, mine, viewerIsRecipient, senderName, recipientName, onSayThanks, onSendBack }: { meta: GiftMeta; mine: boolean; viewerIsRecipient: boolean; senderName: string; recipientName: string; onSayThanks?: () => void; onSendBack?: (stickerId: string | null) => void }) {
  const [bounce, setBounce] = useState(0);
  const [reveal, setReveal] = useState(false);
  const art = meta.animationUrl ?? meta.imageUrl ?? null;
  const rarity = (["rare", "epic", "legendary"].includes(String(meta.rarity)) ? meta.rarity : "common") as Rarity;
  const tag = RARITY_TAG[rarity];
  const line = giftLine(meta, mine, viewerIsRecipient, senderName, recipientName);
  const count = Math.max(1, Math.trunc(meta.quantity ?? 1));
  const canReveal = viewerIsRecipient && !!meta.name;
  return (
    <>
      <button
        type="button"
        onPointerDown={canReveal ? () => void import("./gift-reveal") : undefined}
        onClick={() => {
          if (canReveal) {
            haptic("selection");
            setReveal(true);
          } else setBounce((n) => n + 1);
        }}
        aria-haspopup={canReveal ? "dialog" : undefined}
        aria-label={`${line}${meta.name ? `: ${meta.name}` : ""}${count > 1 ? `, ${count} times` : ""}${meta.note ? `. Note: ${meta.note}` : ""}${canReveal ? ". Open the gift" : ""}`}
        className="flex w-56 max-w-full flex-col items-center gap-1.5 rounded-[22px] border border-white/60 bg-white/80 p-3 text-center text-neutral-900 shadow-frenz-card backdrop-blur"
      >
        <span className="relative">
          {art ? (
            // eslint-disable-next-line @next/next/no-img-element -- the sticker artwork, already a sized WebP
            <img key={bounce} src={art} alt="" className={cn("h-28 w-28 object-contain", bounce > 0 && "motion-safe:animate-[gift-bounce_0.45s_ease-out]")} />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-400/20 text-2xl" aria-hidden>
              🎁
            </span>
          )}
          {count > 1 ? <span className="absolute -right-2 -top-1 rounded-full bg-frenz-gradient-x px-2 py-0.5 text-xs font-extrabold text-white shadow-frenz-card">×{count}</span> : null}
        </span>
        {meta.name ? <span className="text-sm font-bold">{meta.name}</span> : null}
        <span className="text-xs text-neutral-600">{line}</span>
        {/* the note is plain text — React escapes it; it is never treated as markup */}
        {meta.note ? <span className="w-full break-words rounded-xl bg-neutral-900/5 px-2.5 py-1.5 text-[13px] leading-snug text-neutral-800">&ldquo;{meta.note}&rdquo;</span> : null}
        <span className="flex items-center gap-1.5">
          {tag ? <span className={cn("rounded-full px-1.5 text-[10px] font-semibold", tag.className)}>{tag.label}</span> : null}
          {typeof meta.priceFgc === "number" ? <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-bold text-amber-900">{fgcText(meta.priceFgc * count)} FGC</span> : null}
        </span>
        <style>{"@keyframes gift-bounce{0%{transform:scale(1)}45%{transform:scale(1.15)}100%{transform:scale(1)}}"}</style>
      </button>
      {reveal ? (
        <GiftReveal
          meta={meta}
          senderName={senderName}
          onClose={() => setReveal(false)}
          onSayThanks={() => {
            setReveal(false);
            onSayThanks?.();
          }}
          onSendBack={
            onSendBack
              ? () => {
                  setReveal(false);
                  onSendBack(meta.stickerId ?? null);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

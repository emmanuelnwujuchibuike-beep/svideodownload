"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import type { GiftMeta } from "./gift-bubble";
import { fgcText, RARITY_TAG, type Rarity } from "./gift-format";

/*
  Frenz Gift Coin Part 6 — the recipient reveal (design/sticker-gifts.html screen 5): who sent it, the sticker in a
  halo, its rarity and name, what it was worth, the note, and Say thanks / Send one back / Saved to your Gift Box.

  A VIEW of the stored gift, nothing more: every figure is the gift message's (written from the gift record and its
  sticker snapshot, so a later sticker edit changes nothing here). It writes nothing — no "seen" flag (owner decision:
  the existing reveal behaviour is kept, no new database state) — so it can be opened again and again without
  touching a balance, a gift or a notification. Reduce Motion: no pop or drift, a plain fade.
  Portaled to <body> (the standing overlay rule), Escape and the close button dismiss it, focus starts on close.
*/

const CONFETTI: { x: number; y: number; w: number; h: number; c: string; r: number }[] = [
  { x: 12, y: 18, w: 10, h: 5, c: "#FBBF2E", r: 30 },
  { x: 84, y: 15, w: 12, h: 5, c: "#FF6C8C", r: -25 },
  { x: 78, y: 30, w: 9, h: 4, c: "#8FE3FF", r: 60 },
  { x: 18, y: 36, w: 11, h: 4, c: "#B9A6FF", r: -40 },
  { x: 28, y: 25, w: 7, h: 7, c: "#FFD15C", r: 0 },
  { x: 88, y: 44, w: 8, h: 8, c: "#FF6C8C", r: 0 },
  { x: 10, y: 50, w: 6, h: 6, c: "#8FE3FF", r: 0 },
];

export function GiftReveal({ meta, senderName, onClose, onSayThanks, onSendBack }: { meta: GiftMeta; senderName: string; onClose: () => void; onSayThanks: () => void; onSendBack?: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const art = meta.animationUrl ?? meta.imageUrl ?? null;
  const rarity = (["rare", "epic", "legendary"].includes(String(meta.rarity)) ? meta.rarity : "common") as Rarity;
  const tag = RARITY_TAG[rarity];
  const count = Math.max(1, Math.trunc(meta.quantity ?? 1));
  const worth = typeof meta.priceFgc === "number" ? meta.priceFgc * count : null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="gift-reveal-title" className="fixed inset-0 z-[120] flex flex-col overflow-hidden text-white motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 motion-reduce:animate-in motion-reduce:fade-in">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,hsl(var(--frenz-violet)),hsl(var(--frenz-blue))_45%,#0b0820_95%)]" />
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {CONFETTI.map((p, i) => (
          <rect key={i} x={`${p.x}%`} y={`${p.y}%`} width={p.w} height={p.h} rx={2} fill={p.c} transform={`rotate(${p.r})`} style={{ transformBox: "fill-box", transformOrigin: "center" }} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-4 motion-safe:duration-700" />
        ))}
      </svg>

      <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="absolute right-[18px] top-[calc(var(--frenz-safe-top,0px)+14px)] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
        <svg width="14" height="14" viewBox="0 0 14 14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M2 2l10 10M12 2L2 12" />
        </svg>
      </button>

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center px-6 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-[calc(var(--frenz-safe-top,0px)+70px)] text-center">
        <p className="rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-semibold backdrop-blur-md">{count > 1 ? `${senderName} sent you ${count} gifts` : `${senderName} sent you a gift`}</p>
        <div className="mt-6 flex h-56 w-56 items-center justify-center rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.35),transparent_68%)]">
          {art ? (
            // eslint-disable-next-line @next/next/no-img-element -- the sticker as it was when gifted (the message's snapshot)
            <img src={art} alt="" className="h-48 w-48 object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,0.35)] motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500" />
          ) : (
            <span className="text-6xl" aria-hidden>
              🎁
            </span>
          )}
        </div>
        {tag ? <span className={cn("mt-2 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide", tag.className.replace(/bg-\S+/g, ""))}>{tag.label}</span> : null}
        <h2 id="gift-reveal-title" className="mt-2.5 text-[34px] font-extrabold leading-tight tracking-tight">
          {meta.name ?? "A gift"}
          {count > 1 ? <span className="ml-2 align-middle text-2xl">×{count}</span> : null}
        </h2>
        {worth !== null ? (
          <p className="mt-2 text-[15px] text-white/90">
            Worth <strong className="text-white">{fgcText(worth)}</strong> Gift Coins
          </p>
        ) : null}
        {meta.note ? <p className="mt-4 max-w-[300px] break-words rounded-[18px_18px_18px_6px] bg-white/15 px-4 py-3 text-[15px] leading-snug backdrop-blur-md">&ldquo;{meta.note}&rdquo;</p> : null}
        <div className="flex-1" />
        <div className="flex w-full flex-col gap-2.5">
          <button type="button" onClick={onSayThanks} className="h-[52px] rounded-full bg-white text-base font-bold text-frenz-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            Say thanks
          </button>
          {onSendBack ? (
            <button type="button" onClick={onSendBack} className="h-[52px] rounded-full bg-white/15 text-base font-semibold backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              Send one back
            </button>
          ) : null}
          <Link href="/wallet/gifts" prefetch onClick={onClose} className="self-center p-2.5 text-sm font-semibold text-white/90 underline-offset-2 hover:underline">
            Saved to your Gift Box
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}

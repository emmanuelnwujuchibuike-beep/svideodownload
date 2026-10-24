"use client";

import { ArrowRight, Check, Copy, Lock, Share2, X } from "lucide-react";
import { useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import { profilePath } from "@/lib/social/profile-url";

/**
 * "Get paid for your content" — on the owner's own profile, between the hero and
 * the posts tray (owner, 2026-10-11), so a creator sees it the moment they sign in
 * instead of having to find the lock tab.
 *
 *   · Before setup: what SUB is, and one button into the four-step setup.
 *   · Once live: "Your Content. Your Earnings." with Share Profile & Get Paid, the
 *     link itself (/u/<handle>?tab=sub) and Copy.
 *   · Closable: the X hides it for good on every device (0231); everything stays
 *     under the lock tab, which the card points to.
 * Owner-only: a visitor's profile never renders it.
 */
export function SubPromoCard({ handle, live, onOpen, onClose }: { handle: string; live: boolean; onOpen: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}${profilePath(handle)}?tab=sub`;
  const copy = async () => {
    haptic("selection");
    try {
      await navigator.clipboard.writeText(url());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard refused */
    }
  };
  const share = async () => {
    haptic("selection");
    try {
      if (navigator.share) return void (await navigator.share({ title: "Subscribe to my content on Frenz", url: url() }));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    await copy();
  };
  return (
    <section aria-label={live ? "Your subscription link" : "Get paid for your content"} className="relative mb-5 overflow-hidden rounded-[28px] bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-5 pb-5 pt-5 text-white shadow-[0_24px_48px_-24px_rgba(79,70,229,0.9)] ring-1 ring-inset ring-white/15">
      {/*
        "Money talk" (owner 2026-10-12): the rolled-hundreds wallpaper from the Frenz library, as a
        13 KB WebP served from /brand (never the 161 KB original), on the right and faded into the
        brand blue so the white text always sits on the gradient, never on the photo.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a 13 KB local decoration; next/image would add a request hop for nothing */}
      <img src="/brand/sub-money.webp" alt="" aria-hidden width={420} height={569} loading="lazy" decoding="async" className="pointer-events-none absolute inset-y-0 right-0 h-full w-[62%] object-cover" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-blue-600 from-[34%] via-indigo-600/65 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/12 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-cyan-300/25 blur-3xl" />
      <div className="relative flex items-start justify-between gap-3">
        <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/25">
          <Lock className="h-[22px] w-[22px]" />
        </span>
        <span className="flex items-center gap-2">
          {!live ? <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-indigo-700">New</span> : null}
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              haptic("selection");
              onClose();
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/25 transition active:scale-90"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </span>
      </div>
      {live ? (
        <>
          <h2 className="relative mt-4 text-[1.5rem] font-extrabold leading-tight tracking-[-0.03em]">Your Content. Your Earnings.</h2>
          <p className="relative mt-1.5 text-[14.5px] leading-relaxed text-white/85">Share your profile so people can subscribe to your PRIVATE POSTS.</p>
          <button type="button" onClick={() => void share()} className="relative mt-4 inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-bold text-indigo-700 shadow-sm transition active:scale-[0.97]">
            <Share2 className="h-[18px] w-[18px]" aria-hidden /> Share Profile &amp; Get Paid
          </button>
          <div className="relative mt-2.5 flex items-center gap-2 rounded-2xl bg-white/12 py-1.5 pl-3.5 pr-1.5 ring-1 ring-inset ring-white/20">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-white/90">frenzsave.com{profilePath(handle)}?tab=sub</span>
            <button type="button" onClick={() => void copy()} className="inline-flex min-h-[2.25rem] shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 text-[12.5px] font-semibold transition active:scale-95">
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="relative mt-4 text-[1.5rem] font-extrabold leading-tight tracking-[-0.03em]">Get paid for your content</h2>
          <p className="relative mt-1.5 text-[14.5px] leading-relaxed text-white/85">Set a monthly price, post subscriber-only photos and videos, and withdraw your earnings through Paystack or Flutterwave.</p>
          <button type="button" onClick={onOpen} className="relative mt-4 inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-bold text-indigo-700 shadow-sm transition active:scale-[0.97]">
            Set up in 4 steps <ArrowRight className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </>
      )}
      <button type="button" onClick={onOpen} className="relative mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white/80">
        <Lock className="h-3.5 w-3.5" aria-hidden /> Always here under the lock tab below
      </button>
    </section>
  );
}

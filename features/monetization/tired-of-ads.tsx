"use client";

import { ArrowRight, Check, Crown } from "lucide-react";
import Link from "next/link";

import { PRO_FUTURE_LINE, PRO_HIGHLIGHTS } from "@/lib/monetization/plan-features";
import { cn } from "@/lib/utils";

import { useShowAds } from "./use-show-ads";

/**
 * The upgrade card.
 *
 * Gated on `useShowAds()`, which is already false for Pro and Business — so a
 * paying visitor NEVER sees an upgrade-to-Pro message, per the owner's rule.
 *
 * ── 🔴 REBUILT 2026-10-04: IT SOLD ONE FEATURE AND MISSTATED ANOTHER ───────
 *
 * Owner: "summary all the existing pro features on the upgrade card not just ad
 * free, so users see they can download in high quality, use AI, and all, also
 * all future features."
 *
 * It said "ad-free library, more storage and faster downloads" under the
 * headline "Tired of ads?" — so Pro read as an ad-blocker with a bit of space,
 * which is the smallest possible version of what it is. Worse, "faster
 * downloads" was a claim the pricing page's own audit had already struck out:
 * there is no download-speed or queue differentiation anywhere in the pipeline.
 *
 * Now it lists the real set, from `lib/monetization/plan-features.ts` — the one
 * list the pricing page reads too, so the card and the page cannot drift.
 *
 * ── What is deliberately NOT claimed, and why it matters here most ─────────
 *
 * The brief asks to say Pro means "download in high quality" and "use AI".
 * Neither is true as a GATE, and this card is the last place to find that out:
 *
 *   · quality is never plan-gated — everybody gets the same formats. What Pro
 *     removes is the ad in front of a top-quality or 100 MB+ file, which is
 *     what the first highlight says.
 *   · Frenz AI is pay-per-generation for everyone. What a site plan lifts is
 *     the concurrency (1 → 2), which is what the AI highlight says.
 *
 * Both are still good reasons to pay, and both survive a member checking.
 */
export function TiredOfAds({ className }: { className?: string }) {
  const { showAds, ready } = useShowAds();
  if (!ready || !showAds) return null;

  return (
    <Link
      href="/pricing"
      className={cn(
        "group relative block overflow-hidden rounded-3xl border border-violet-500/20 bg-gradient-to-br from-blue-600/[0.07] via-violet-600/[0.08] to-fuchsia-600/[0.07] p-4 shadow-soft transition hover:border-violet-500/40 sm:p-5",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full"
      />

      <div className="relative flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-violet-500/25">
          <Crown className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold tracking-[-0.01em] sm:text-base">Everything Pro gives you</p>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-[13px]">One upgrade, across downloads, storage and Frenz AI.</p>
        </div>
      </div>

      {/*
        The list, not a sentence. Four short lines a person can scan in the time
        they would have spent reading one long one — and each is a fact with a
        mechanism behind it (see `plan-features.ts`).
      */}
      <ul className="relative mt-3.5 grid gap-1.5">
        {PRO_HIGHLIGHTS.map((line) => (
          <li key={line} className="flex items-start gap-2 text-[12.5px] font-medium leading-snug sm:text-[13px]">
            <Check className="mt-[1px] h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>

      {/* The forward-looking promise the brief asks for — about ACCESS, never
          about a feature nobody has built. */}
      <p className="relative mt-2 text-[11.5px] italic text-muted-foreground">{PRO_FUTURE_LINE}</p>

      <span className="relative mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-violet-500/25 transition group-hover:shadow-lg group-hover:shadow-violet-500/30">
        Upgrade to Pro <ArrowRight className="h-4 w-4" />
      </span>
    </Link>
  );
}

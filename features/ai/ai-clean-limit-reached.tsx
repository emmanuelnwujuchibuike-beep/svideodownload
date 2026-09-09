"use client";

import { ArrowRight, Clock3, Crown, Sparkles } from "lucide-react";
import Link from "next/link";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import type { AiCleanEntitlement } from "@/lib/ai/client";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ALLOWANCE IS SPENT — shown INSTEAD of the picker
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "a free user can still use the ai, is not suppose to be
 * so... it shouldnt work when uploading a video, it should show upgrade to pro
 * when a user want to upload when they reach their free limit."
 *
 * ── 🔴 THE CAP WAS ALWAYS ENFORCED. IT WAS ENFORCED TOO LATE. ───────────────
 *
 * Nobody was getting free AI. `reserveAiUsage` is a single atomic statement and
 * it fails closed, so a fourth job was always refused. What was missing is that
 * NOTHING ASKED BEFORE THE UPLOAD: the drop zone rendered unconditionally, so a
 * member at their limit chose a file, watched a 100 MB upload finish, and only
 * then got `DAILY_LIMIT_REACHED`.
 *
 * `entitlement.canStart` has been on the wire since Part 5 and only the
 * allowance BAR consulted it — the comment in lib/ai/policy.ts even says "the
 * interface shows the limit-reached state instead of a Watch Ad button", and
 * that state did not exist. This is it.
 *
 * ── It is a courtesy, not the gate ──────────────────────────────────────────
 *
 * This panel renders from a value that lives in a browser the member controls,
 * so it can be edited away — and that changes nothing. `/api/ai/jobs/[id]/start`
 * re-resolves the entitlement and re-reserves the slot on every request. What
 * this buys is the member's time and bandwidth, not the owner's money.
 */
export function AICleanLimitReached({
  entitlement,
  className,
}: {
  entitlement: AiCleanEntitlement;
  className?: string;
}) {
  const limit = entitlement.dailyLimit;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[1.5rem] border border-primary/20",
        "bg-gradient-to-br from-violet-500/[0.10] via-primary/[0.06] to-transparent",
        "px-5 py-6 text-center sm:px-7 sm:py-8",
        className,
      )}
      aria-live="polite"
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/25">
        <FrenzLogo size={22} alt="" />
      </span>

      <h2 className="mt-3.5 text-[1.35rem] font-bold leading-tight tracking-[-0.02em]">
        You&apos;ve used today&apos;s{" "}
        <span className="text-gradient">free videos</span>
      </h2>

      <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
        {limit
          ? `Free members get ${limit} AI Clean ${limit === 1 ? "video" : "videos"} a day.`
          : "Your free AI Clean videos for today are used up."}{" "}
        {/*
          🔴 SAID PLAINLY, AND IT IS TRUE. The reset is midnight UTC because
          `ai_usage_daily` is keyed on a UTC `usage_date` — quoting local
          midnight would be wrong for most of the people using this.
        */}
        They reset at midnight UTC.
      </p>

      <Link
        href="/pricing"
        prefetch={false}
        className={cn(
          "group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 sm:w-auto sm:px-8",
          "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500",
          "text-sm font-bold text-white shadow-[0_14px_34px_-12px_rgb(99_102_241/0.95)]",
          "transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
        )}
      >
        <Crown className="h-4 w-4" aria-hidden />
        Upgrade to Pro
        <ArrowRight
          className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>

      {/*
        ── 🔴 EVERY LINE HERE IS SOMETHING PRO ACTUALLY GIVES TODAY ───────────

        No "faster GPU processing", because both plans run the same model on the
        same hardware. Selling a speed tier that does not exist would be the one
        promise a member could check in a minute and find false — and the first
        thing they would blame when a Pro job took just as long.
      */}
      <ul className="mx-auto mt-5 flex max-w-xs flex-col gap-2 text-left">
        {[
          { icon: Sparkles, text: "No daily limit on AI Clean" },
          { icon: Clock3, text: "No ads before a video is cleaned" },
        ].map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2.5 text-[13px] font-medium">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            {text}
          </li>
        ))}
      </ul>

      <p className="mt-5 text-xs text-muted-foreground">
        Your finished videos are still in your history for three days.
      </p>
    </section>
  );
}

"use client";

import Link from "next/link";

import { AICleanProBadge } from "@/features/ai/ai-clean-pro-badge";
import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import type { AiCleanEntitlement } from "@/lib/ai/client";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What this member may do today
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three different sentences, because there are three genuinely different
 * situations and blurring them is how a paywall starts feeling like a trap.
 *
 * ── Informative, not aggressive ──────────────────────────────────────────────
 *
 * The brief is explicit: "Keep this informative rather than aggressive", and
 * "Do not say Pay now or Upgrade immediately unless the user chooses to view Pro
 * options". So a member with cleans left is told the count and nothing else —
 * no upsell beside a button they are about to press. The upgrade offer appears
 * once, at the moment it is actually relevant: when the day's allowance is gone
 * and it is the only thing that would help.
 *
 * ── 🔴 EVERY NUMBER HERE CAME FROM THE SERVER ────────────────────────────────
 *
 * And none of it is authority. `ai_usage_daily` is the source of truth, this is
 * a rendering of it, and the start request re-resolves all of it. Nothing in
 * this component is ever read back to decide whether a job may run — that
 * would be exactly the client-side authority the brief forbids.
 */
export function AICleanAllowance({
  entitlement,
  className,
}: {
  entitlement: AiCleanEntitlement | null;
  className?: string;
}) {
  // Nothing known yet. Rendering "0 of 3" while the answer is in flight would
  // flash a limit at somebody who has not reached one.
  if (!entitlement) return null;

  /* ── Paid: no count, no ad, no upsell ── */
  if (entitlement.unlimited) {
    return (
      <div className={cn("flex items-center justify-center gap-2 text-xs text-muted-foreground", className)}>
        <AICleanProBadge />
        <span>Unlimited AI Clean</span>
      </div>
    );
  }

  const remaining = entitlement.remainingToday ?? 0;
  const limit = entitlement.dailyLimit ?? 0;

  /* ── Spent: the one moment an upgrade is the useful thing to say ── */
  if (!entitlement.canStart) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-border/70 bg-secondary/30 px-4 py-4 text-center",
          className,
        )}
      >
        <FrenzAICore presence="settled" size="md" className="mx-auto" />
        <p className="mt-2.5 text-sm font-semibold">
          You&apos;ve used your {limit} free AI Clean sessions for today
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Your free cleans come back tomorrow. Pro removes the daily limit and the ads.
        </p>
        <div className="mt-3.5 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Link href="/account/plan" prefetch className="btn-lux btn-lux-primary">
            Upgrade to Pro
          </Link>
          <span className="text-xs text-muted-foreground">or come back tomorrow</span>
        </div>
      </div>
    );
  }

  /* ── Free, with cleans left ── */
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs", className)}>
      {/*
        Dots, not just a number: "how many are left" is read faster as shape
        than as arithmetic, and it is the same idea the credit indicator will
        use when Part 10 brings credits.
      */}
      <span className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: limit }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              i < remaining ? "bg-primary" : "bg-border",
            )}
          />
        ))}
      </span>
      <span className="font-medium text-muted-foreground">
        {remaining} of {limit} free cleans left today
      </span>
      {entitlement.rewardRequired ? (
        <span className="text-muted-foreground/80">· each unlocked by a short ad</span>
      ) : null}
    </div>
  );
}

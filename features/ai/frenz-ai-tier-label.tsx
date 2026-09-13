"use client";

import { Crown, Zap } from "lucide-react";

import type { AiMemberEntitlement } from "@/lib/ai/client";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE TIER ROW — what this member's plan is, said once
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 THE UPSELL LADDER IS GONE WITH AI CLEAN (2026-09-13) ─────────────────
 *
 * This component used to sell every plan the rung above it: "Upgrade to Pro —
 * no ads before a clean, and no daily limit", "Business is faster", "Max AI
 * cleans more accurately". Every one of those sentences was about AI Clean:
 * its free allowance, its hardware tiers, its detection model. None of them is
 * true of Character Replace, which is paid per run from the balance on every
 * plan, on the same model, in the same queue.
 *
 * Owner, 2026-09-09: "Do not remove the existing plan description." So the
 * row stays, and what it now says is only what is true: the plan this member
 * is on. A free member sees nothing here — there is no plan sentence that is
 * both true and worth a line — and the entry card's own copy does the
 * explaining.
 *
 * Rendered from the server's entitlement, never from a local guess: a flash of
 * the wrong tier is worse than a beat of nothing.
 */
export function FrenzAITierLabel({
  entitlement,
  className,
  variant = "chip",
}: {
  entitlement: AiMemberEntitlement | null;
  className?: string;
  /** `row` is the welcome page's full-width treatment; `chip` sits inline. */
  variant?: "chip" | "row";
}) {
  if (!entitlement) return null;

  const plan =
    entitlement.audience === "max_ai"
      ? { label: "Max AI", icon: Crown, tone: "border-amber-400/30 bg-gradient-to-r from-amber-400/[0.14] to-fuchsia-500/[0.10] text-amber-700 dark:text-amber-300" }
      : entitlement.audience === "business"
        ? { label: "Business", icon: Crown, tone: "border-amber-400/30 bg-amber-400/[0.10] text-amber-700 dark:text-amber-300" }
        : entitlement.audience === "pro"
          ? { label: "Pro", icon: Zap, tone: "border-primary/25 bg-primary/[0.08] text-primary" }
          : null;

  if (!plan) return null;
  const Icon = plan.icon;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold",
        plan.tone,
        variant === "row" && "w-full justify-center py-2",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>{plan.label} member</span>
    </div>
  );
}

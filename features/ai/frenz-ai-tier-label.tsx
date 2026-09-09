"use client";

import { Crown, Sparkles, Zap } from "lucide-react";
import Link from "next/link";

import type { AiCleanEntitlement } from "@/lib/ai/client";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHICH TIER IS CLEANING THIS VIDEO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "max ai will use BRIA model, put a label in the ai pages
 * to use max ai for clean accurate ai clean with faster gpu, while pro and
 * business uses just gpu and not BRIA."
 *
 * Two jobs in one small component, and they are opposite:
 *
 *   · a member ALREADY on the tier is told what they are getting, so the thing
 *     they pay for is visible while it works;
 *   · a member BELOW it is told what the tier above does, at the moment they
 *     are looking at a result and can judge whether it is worth it.
 *
 * ── 🔴 IT SAYS NOTHING UNTIL THE MODEL EXISTS ───────────────────────────────
 *
 * `briaOffered` and `gpuOffered` come from the server and mean "this deployment
 * really has that model", not "this plan is entitled to it". Neither model is
 * published yet — the GPU build was disabled by Replicate on 2026-09-08 and
 * BRIA has not been set up — so today this renders NOTHING for everybody.
 *
 * That is the whole design. A label promising "more accurate" on a plan that
 * currently runs the same model as free is a claim a member can disprove in one
 * comparison, and it would poison the upgrade it was meant to sell. The label
 * turns itself on the day the model is configured, with no code change.
 */
export function FrenzAITierLabel({
  entitlement,
  className,
}: {
  entitlement: AiCleanEntitlement | null;
  className?: string;
}) {
  if (!entitlement) return null;

  const tier = entitlement.modelTier;
  const briaOffered = entitlement.briaOffered === true;
  const gpuOffered = entitlement.gpuOffered === true;

  /* ── Already on Max AI: state it, quietly and with authority. ───────────── */
  if (tier === "bria") {
    return (
      <Chip
        className={cn(
          "border-amber-400/30 bg-gradient-to-r from-amber-400/[0.14] to-fuchsia-500/[0.10] text-amber-700 dark:text-amber-300",
          className,
        )}
        icon={<Crown className="h-3.5 w-3.5" aria-hidden />}
      >
        Max AI · most accurate cleanup
      </Chip>
    );
  }

  /* ── On the GPU tier: say what it is, and do NOT imply it is the top. ───── */
  if (tier === "gpu") {
    return (
      <Chip
        className={cn("border-primary/25 bg-primary/[0.07] text-primary", className)}
        icon={<Zap className="h-3.5 w-3.5" aria-hidden />}
      >
        Running on faster GPU
      </Chip>
    );
  }

  /*
    ── Below the tiers: the upsell, and ONLY for capabilities that exist ──────

    🔴 The wording follows what is actually deployed. If BRIA is live it leads
    with accuracy, because that is what Max AI is for and it is the stronger
    reason to move. If only the GPU model is live it offers speed and says
    nothing about accuracy. If neither is live it renders nothing at all rather
    than inventing a reason to upgrade.
  */
  if (!briaOffered && !gpuOffered) return null;

  return (
    <Link
      href="/pricing"
      prefetch={false}
      className={cn(
        "group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition",
        "border-border/70 bg-card/95 text-muted-foreground hover:border-primary/30 hover:text-foreground",
        className,
      )}
    >
      <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
      {briaOffered
        ? "Max AI cleans more accurately, on faster GPU"
        : "Upgrade for faster GPU processing"}
    </Link>
  );
}

/** The shared pill. Static — no animation on a screen that stays open. */
function Chip({
  icon,
  children,
  className,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

"use client";

import { ArrowRight, Crown, Sparkles, Zap } from "lucide-react";
import Link from "next/link";

import type { AiCleanEntitlement } from "@/lib/ai/client";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHICH TIER IS CLEANING THIS VIDEO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "I don't see an upgrade to pro for faster quality edit in
 * free uses AI pages like the progress page, and same with pro and business."
 *
 * Two jobs, and they are opposites:
 *
 *   · a member ALREADY on a paid tier is told what they are getting, so the
 *     thing they pay for is visible while it works;
 *   · a member BELOW one is shown what the tier above does, at the moment they
 *     are watching a progress bar and have nothing else to read.
 *
 * ── 🔴 SOMETHING TRUE IS ALWAYS SAID; THE CLAIMS ARE WHAT IS GATED ─────────
 *
 * The first version of this rendered NOTHING unless a GPU or BRIA model was
 * configured — and neither is, so the owner saw a blank space where they had
 * asked for an upsell. That was the honesty rule applied one level too far.
 *
 * The fix is to separate the two kinds of statement:
 *
 *   ALWAYS SAFE   "no ads, no daily limit" — Pro gives that today, it is
 *                 enforced server-side, and a member can verify it in a minute.
 *   GATED         "faster GPU", "cleans more accurately" — those depend on a
 *                 model existing. `gpuOffered` / `briaOffered` come from the
 *                 server and mean "this deployment really has it", not "this
 *                 plan is entitled to it".
 *
 * So the row always appears with a real benefit, and the speed and accuracy
 * lines switch themselves on the day the models are configured. Selling a
 * capability a member can disprove in one comparison would poison the upgrade
 * it was meant to sell.
 */
export function FrenzAITierLabel({
  entitlement,
  className,
  /** `chip` for a tight strip; `row` for a tappable card with a chevron. */
  variant = "chip",
}: {
  entitlement: AiCleanEntitlement | null;
  className?: string;
  variant?: "chip" | "row";
}) {
  // Nothing is claimed before the server has answered — a flash of the wrong
  // tier is worse than a beat of nothing.
  if (!entitlement) return null;

  const tier = entitlement.modelTier;
  const briaOffered = entitlement.briaOffered === true;
  const gpuOffered = entitlement.gpuOffered === true;
  const paid = entitlement.unlimited || (tier !== "standard" && tier !== undefined);

  /* ── Already on Max AI: state it, and sell nothing. ─────────────────────── */
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

  /*
    ── Pro / Business ──────────────────────────────────────────────────────

    They are told what they have. The Max AI line only appears if BRIA is
    really deployed — otherwise there is nothing above them worth naming, and
    inventing one would be selling a plan that cannot yet do anything extra.
  */
  if (paid) {
    if (briaOffered) {
      return (
        <UpsellRow
          className={className}
          variant={variant}
          icon={<Crown className="h-3.5 w-3.5" aria-hidden />}
          title="Max AI cleans more accurately"
          body="A stronger model for detailed backgrounds and text over faces."
        />
      );
    }
    return (
      <Chip
        className={cn("border-primary/25 bg-primary/[0.07] text-primary", className)}
        icon={gpuOffered ? <Zap className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
      >
        {gpuOffered ? "Running on faster GPU" : "No ads, no daily limit"}
      </Chip>
    );
  }

  /*
    ── Free and guest: the upgrade ─────────────────────────────────────────

    🔴 The headline follows what is actually deployed, strongest true reason
    first. Speed is the better sell while somebody is WATCHING A PROGRESS BAR,
    so it leads whenever a GPU model exists; otherwise the row falls back to the
    two things Pro genuinely removes today.
  */
  return (
    <UpsellRow
      className={className}
      variant={variant}
      icon={<Crown className="h-3.5 w-3.5" aria-hidden />}
      title={
        briaOffered
          ? "Upgrade for more accurate cleanup"
          : gpuOffered
            ? "Upgrade for faster, higher-quality edits"
            : "Upgrade to Pro"
      }
      body={
        gpuOffered || briaOffered
          ? "Pro runs on faster GPU hardware — no ads, no daily limit."
          : "No ads before a clean, and no daily limit."
      }
    />
  );
}

/** The pill. Static — no animation on a screen that stays open for minutes. */
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

/** The upgrade, as a chip or a full row depending on how much room there is. */
function UpsellRow({
  icon,
  title,
  body,
  variant,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  variant: "chip" | "row";
  className?: string;
}) {
  if (variant === "chip") {
    return (
      <Link
        href="/pricing"
        prefetch={false}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition",
          "border-border/70 bg-card/95 text-muted-foreground hover:border-primary/30 hover:text-foreground",
          className,
        )}
      >
        {icon}
        {title}
        <ArrowRight className="h-3 w-3" aria-hidden />
      </Link>
    );
  }

  return (
    <Link
      href="/pricing"
      prefetch={false}
      className={cn(
        "group flex w-full items-center gap-3 rounded-2xl border border-primary/20 px-4 py-3",
        "bg-gradient-to-r from-violet-500/[0.08] via-primary/[0.05] to-transparent",
        "transition hover:border-primary/35 active:scale-[0.995]",
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold leading-tight">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{body}</span>
      </span>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-primary transition-transform motion-safe:group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}

"use client";

import { ArrowRight, Crown, Zap } from "lucide-react";
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

  const audience = entitlement.audience;
  const briaOffered = entitlement.briaOffered === true;
  const gpuOffered = entitlement.gpuOffered === true;

  /*
    ── 🔴 EACH PLAN IS SHOWN THE NEXT ONE, NOT ALWAYS PRO ──────────────────

    Owner, 2026-09-09: "the upgrade to pro prompt in the AI pages should only
    be in free users, while pro users show upgrade to business for faster
    generation time, and max ai for cleaner and faster generation."

    Selling Pro to somebody already paying for Pro is the clearest possible
    signal that a product is not reading its own state — the same rule the
    input page already follows for its Pro card. So this is a LADDER: every
    tier is offered the rung above it, and the top rung is offered nothing.
  */
  if (audience === "max_ai") {
    return (
      <Chip
        className={cn(
          "border-amber-400/30 bg-gradient-to-r from-amber-400/[0.14] to-fuchsia-500/[0.10] text-amber-700 dark:text-amber-300",
          className,
        )}
        icon={<Crown className="h-3.5 w-3.5" aria-hidden />}
      >
        {briaOffered ? "Max AI · most accurate cleanup" : "Max AI"}
      </Chip>
    );
  }

  if (audience === "business") {
    return (
      <UpsellRow
        className={className}
        variant={variant}
        icon={<Crown className="h-3.5 w-3.5" aria-hidden />}
        title="Max AI cleans more accurately"
        body={
          briaOffered
            ? "A stronger model for detailed backgrounds and text over faces — and the fastest queue."
            : "The top tier, for detailed backgrounds and text over faces."
        }
      />
    );
  }

  if (audience === "pro") {
    return (
      <UpsellRow
        className={className}
        variant={variant}
        icon={<Zap className="h-3.5 w-3.5" aria-hidden />}
        title="Business is faster"
        body="More generations at once, and your videos start sooner."
      />
    );
  }

  /*
    Free and guest. 🔴 The headline only promises SPEED when a GPU model is
    really deployed — see the note at the top. Otherwise it sells the two
    things Pro genuinely removes today, both of which a member can verify.
  */
  return (
    <UpsellRow
      className={className}
      variant={variant}
      icon={<Crown className="h-3.5 w-3.5" aria-hidden />}
      title={
        briaOffered || gpuOffered
          ? "Upgrade for faster, higher-quality edits"
          : "Upgrade to Pro"
      }
      body={
        gpuOffered || briaOffered
          ? "Pro runs on faster hardware — no ads, no daily limit."
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

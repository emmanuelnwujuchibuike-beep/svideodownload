import { ChevronRight, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { AICleanProBadge } from "@/features/ai/ai-clean-pro-badge";
import Link from "next/link";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import type { AiCleanEntitlement } from "@/lib/ai/client";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SMALL FURNITURE THE FRENZ AI SCREENS SHARE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The breadcrumb pill, the allowance bar and the trust row appear on BOTH of
 * the owner's references (`public/frenz ai welcome page.jpg` and
 * `public/ai input page.jpg`), pixel for pixel the same in each.
 *
 * Written once because they are the same thing twice. Written twice they drift
 * — one gets a different radius, the other a different gap — and two screens a
 * person moves between in one tap stop looking like one product, which is
 * exactly what the visual work is for.
 *
 * Server components: no hooks, no state. See the note in
 * frenz-ai-tool-card.tsx about what marking one of these `"use client"` did.
 */

/**
 * `[F] Frenz AI / AI Clean [PRO]`
 *
 * A real `<nav>` with an ordered list, not a row of divs. It IS a breadcrumb,
 * and a screen reader should be able to say so — the visual treatment is a
 * pill, but the meaning is a trail.
 */
export function FrenzAICrumb({
  tool = "AI Clean",
  pro = true,
  className,
}: {
  tool?: string;
  /** The gold tier chip from the reference. */
  pro?: boolean;
  className?: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/95 py-1.5 pl-1.5 pr-3 shadow-[0_6px_20px_-14px_hsl(229_55%_3%/0.5)]",
        className,
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#131a4a]">
        <FrenzLogo size={16} alt="" />
      </span>
      <ol className="flex items-center gap-1.5 text-[13px]">
        <li className="text-muted-foreground">Frenz AI</li>
        <li aria-hidden className="text-muted-foreground/50">
          /
        </li>
        <li className="font-semibold" aria-current="page">
          {tool}
        </li>
      </ol>
      {/*
        🔴 THE PLATFORM SEAL, AND ONLY FOR SOMEBODY WHO HAS ONE.

        Owner, 2026-09-09: "use the platform own pro and business badge without
        the text pro or business or max, just with their badge."

        This was a gold PRO pill rendered on every Frenz AI page regardless of
        who was looking — a free member saw it, and so did a Business member,
        because it labelled the FEATURE rather than the viewer. The platform
        already has one mark per tier; a second one invented here is how a
        product stops looking like one product.

        `AICleanProBadge` now draws the viewer's own seal and renders nothing
        for a free member, so the `pro` prop is a request to SHOW the slot, not
        a claim that the viewer has a plan.
      */}
      {pro ? <AICleanProBadge className="ml-0.5" /> : null}
      </nav>
  );
}

/**
 * The allowance, as the references draw it: a wide pill with the mark, the
 * count, a progress bar underneath and a chevron.
 *
 * ── 🔴 EVERY NUMBER CAME FROM THE SERVER, AND NONE OF IT IS AUTHORITY ────────
 *
 * `ai_usage_daily` is the source of truth and the start request re-resolves all
 * of it. Nothing here is ever read back to decide whether a job may run — that
 * would be exactly the client-side authority the brief forbids.
 *
 * Renders nothing at all while the entitlement is unknown. Showing "0 of 0"
 * for a moment would flash a limit at somebody who has not reached one, and on
 * a slow connection that moment is long enough to read.
 */
export function FrenzAIAllowanceBar({
  entitlement,
  href = "/account/plan",
  className,
}: {
  entitlement: AiCleanEntitlement | null;
  href?: string;
  className?: string;
}) {
  if (!entitlement) return null;

  // A plan with no product cap has no bar to draw — quoting a ceiling nobody
  // reaches would invent a restriction they are not under.
  if (entitlement.unlimited) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border border-border/60 bg-card/95 px-4 py-3",
          className,
        )}
      >
        <Mark />
        <p className="text-[13px] font-semibold">Unlimited AI Clean</p>
      </div>
    );
  }

  const limit = entitlement.dailyLimit ?? 0;
  const remaining = entitlement.remainingToday ?? 0;
  const used = Math.max(0, limit - remaining);
  const pct = limit > 0 ? Math.round((remaining / limit) * 100) : 0;

  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        "group flex items-center gap-3 rounded-2xl border border-border/60 bg-card/95 px-3.5 py-3",
        "shadow-[0_8px_26px_-18px_hsl(229_55%_3%/0.55)] transition hover:border-foreground/15",
        className,
      )}
    >
      <Mark />

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-tight">
          <span className="font-bold">{remaining}</span>{" "}
          <span className="text-muted-foreground">
            of {limit} free {limit === 1 ? "clean" : "cleans"} left today
          </span>
        </span>
        {/*
          A real meter, not a decorative bar. `aria-*` carries the same numbers
          the text does, so the two can never disagree — and the text is there
          for anyone the bar does not reach.
        */}
        <span
          role="meter"
          aria-valuenow={remaining}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label={`${remaining} of ${limit} free cleans left today, ${used} used`}
          className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-secondary"
        >
          <span
            className="block h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-fuchsia-500 transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${Math.max(3, pct)}%` }}
          />
        </span>
      </span>

      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}

function Mark() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#131a4a]">
      <FrenzLogo size={18} alt="" />
    </span>
  );
}

/**
 * `Fast · Secure · Natural Results`, with hairline dividers.
 *
 * Deliberately quiet — muted, small, no colour. It is reassurance at the bottom
 * of a page, not a feature list, and the references draw it that way.
 */
const TRUST = [
  { icon: Zap, label: "Fast" },
  { icon: ShieldCheck, label: "Secure" },
  { icon: Sparkles, label: "Natural Results" },
] as const;

export function FrenzAITrustRow({ className }: { className?: string }) {
  return (
    <ul className={cn("flex items-center justify-center", className)}>
      {TRUST.map((item, i) => (
        <li
          key={item.label}
          className={cn(
            "flex items-center gap-1.5 px-3 text-[11.5px] font-medium text-muted-foreground sm:px-4",
            i > 0 && "border-l border-border/70",
          )}
        >
          <item.icon className="h-3.5 w-3.5 text-primary/70" aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

"use client";

import { ArrowRight, Coins } from "lucide-react";
import Link from "next/link";

import { useAiCreditBalance } from "@/features/ai/design/ai-credit-strip";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { formatCompactCredits, formatCredits } from "@/lib/ai/credits/units";
import { cn } from "@/lib/utils";

/**
 * The Frenz AI welcome page's two balance pieces (step 16, design/AIStudio.dc.html, 2026-10-19). Both
 * read the one live snapshot the credit strip keeps (`useAiCreditBalance`) — no request of their own,
 * and a top-up or spend repaints them with everything else.
 */

/** The design's glass pill on the hero (glass because it sits over the featured video). Nothing for a guest. */
export function AiCreditsPill({ className }: { className?: string }) {
  const { who, balance } = useAiCreditBalance();
  if (who !== "member") return null;
  return (
    <span
      className={cn(
        "flex h-11 items-center gap-1.5 rounded-full ai-glass ai-glass--media px-3.5 text-[15px] font-bold tabular-nums text-white",
        className,
      )}
      title={balance ? formatCredits(balance.balanceCents) : undefined}
    >
      <Coins className="h-4 w-4" aria-hidden />
      <span aria-hidden>{balance ? formatCompactCredits(balance.balanceCents) : "—"}</span>
      <span className="sr-only">{balance ? `${formatCredits(balance.balanceCents)} — your AI balance` : "AI balance loading"}</span>
    </span>
  );
}

/**
 * The credits card: the real balance, Earn (the quests) and View (usage & history) — the flows the
 * strip already opens. A guest sees the sign-in door instead of a figure nobody has.
 */
export function AiCreditsCard({ base, className }: { base: string; className?: string }) {
  const { who, balance, freeLeft } = useAiCreditBalance();
  return (
    <div className={cn("flex min-h-[64px] items-center gap-3 rounded-[20px] border border-frenz-line bg-frenz-card py-3 pl-3.5 pr-3 shadow-frenz-card", className)}>
      {/* a small identity badge — one of the places the gradient may go */}
      <span aria-hidden className="frenz-icon-glass text-frenz-violet flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
        <Coins className="h-5 w-5" />
      </span>
      {who === "guest" ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="block font-heading text-[16px] font-bold text-frenz-ink">Frenz AI</span>
            <span className="block truncate text-[12px] font-semibold text-frenz-muted">Sign in to create</span>
          </span>
          <Link href={`/login?next=${encodeURIComponent(base)}`} className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-frenz-violet/10 px-3.5 text-[14px] font-bold text-frenz-violet">
            Sign in <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1" aria-live="polite">
            <span className="block truncate font-heading text-[18px] font-bold tabular-nums text-frenz-ink" title={balance ? formatCredits(balance.balanceCents) : undefined}>
              {balance ? formatCredits(balance.balanceCents) : who === "member" ? "—" : " "}
            </span>
            <span className="block truncate text-[12px] font-semibold text-frenz-muted">
              AI credits balance
              {freeLeft !== null ? ` · ${freeLeft} free ${freeLeft === 1 ? "creation" : "creations"}` : ""}
            </span>
          </span>
          <TapOnceLink
            href="/quests"
            warmOnIdle
            spinner={false}
            aria-label="Earn credits"
            className="flex h-9 shrink-0 items-center rounded-full bg-frenz-violet/10 px-3.5 text-[14px] font-bold text-frenz-violet no-underline data-[pending]:opacity-70"
          >
            Earn
          </TapOnceLink>
          <TapOnceLink
            href={`${base}/usage`}
            spinner={false}
            aria-label="View credits"
            className="flex h-9 shrink-0 items-center rounded-full border border-frenz-line px-3.5 text-[14px] font-bold text-frenz-ink no-underline data-[pending]:opacity-70"
          >
            View
          </TapOnceLink>
        </>
      )}
    </div>
  );
}

/** The same balance as a light pill for a white page header (the AI Studio, step 17). Nothing for a guest. */
export function AiCreditsChip({ className }: { className?: string }) {
  const { who, balance } = useAiCreditBalance();
  if (who !== "member") return null;
  return (
    <span
      className={cn("flex h-10 items-center gap-1.5 rounded-full border border-frenz-line bg-frenz-card px-3.5 text-[15px] font-bold tabular-nums text-frenz-ink shadow-frenz-card", className)}
      title={balance ? formatCredits(balance.balanceCents) : undefined}
    >
      <Coins className="h-4 w-4 text-frenz-violet" aria-hidden />
      <span aria-hidden>{balance ? formatCompactCredits(balance.balanceCents) : "—"}</span>
      <span className="sr-only">{balance ? `${formatCredits(balance.balanceCents)} — your AI balance` : "AI balance loading"}</span>
    </span>
  );
}

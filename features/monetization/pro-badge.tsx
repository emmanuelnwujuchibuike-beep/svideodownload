import { Crown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The PRO badge — the one mark that says "this is a Pro feature" (owner,
 * 2026-10-04: "also show pro features offer a pro badge").
 *
 * One component rather than a span repeated per surface, for the same reason
 * `plan-features.ts` is one list: a badge drawn five slightly different ways
 * reads as five different things, and the fifth one eventually says BUSINESS by
 * mistake.
 *
 * 🔴 It marks a feature, it does not GATE one. Nothing here checks a plan —
 * every real gate lives on the server (`getPlanLimits`, `reward-policy`,
 * `lib/ai/policy`). A badge that decided access would be a second opinion about
 * who has paid, and the wrong one would eventually be the one that ran.
 */
export function ProBadge({ tier = "pro", className }: { tier?: "pro" | "business"; className?: string }) {
  const business = tier === "business";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-white",
        business
          ? "bg-gradient-to-r from-amber-500 to-orange-500 shadow-[0_1px_6px_-2px_rgba(245,158,11,0.8)]"
          : "bg-gradient-to-r from-blue-600 to-violet-600 shadow-[0_1px_6px_-2px_rgba(109,92,255,0.9)]",
        className,
      )}
    >
      <Crown className="h-2.5 w-2.5" aria-hidden />
      {business ? "Business" : "Pro"}
    </span>
  );
}

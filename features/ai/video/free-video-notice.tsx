"use client";

import { Gift } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * THE FREE VIDEO, SAID BEFORE THE PRESS (owner, 2026-10-07): "make users who
 * want to use free video generation be informed that free only supports
 * 720p, 3 seconds and no reference video or native audio on free."
 *
 * Every fact is the server's (POST /api/ai/video/quote → `complimentary`):
 * whether the member still has a free video, whether THESE settings would use
 * it, the rules line, and which setting is in the way. Shown only to a member
 * who has one left — nobody else is told about an offer they cannot take.
 */
export interface FreeVideoOffer {
  available: boolean;
  eligible: boolean;
  rules: string;
  blockedBy: string | null;
}

export function FreeVideoNotice({ offer, className }: { offer: FreeVideoOffer | null; className?: string }) {
  if (!offer?.available) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-[12.5px] leading-relaxed ring-1 ring-inset",
        offer.eligible ? "bg-emerald-500/[0.07] text-emerald-900 ring-emerald-500/25 dark:text-emerald-200" : "bg-violet-500/[0.06] text-foreground ring-violet-500/20",
        className,
      )}
    >
      <Gift className={cn("mt-0.5 h-4 w-4 shrink-0", offer.eligible ? "text-emerald-600 dark:text-emerald-400" : "text-violet-600 dark:text-violet-300")} aria-hidden />
      <p className="min-w-0">
        {offer.eligible ? (
          <>
            <strong className="font-semibold">This is your free video.</strong> Free covers {offer.rules}.
          </>
        ) : (
          <>
            <strong className="font-semibold">You have a free video.</strong> Free covers {offer.rules} only.
            {offer.blockedBy ? ` ${offer.blockedBy}` : ""} Change these settings to use it — otherwise this one is paid with credits.
          </>
        )}
      </p>
    </div>
  );
}

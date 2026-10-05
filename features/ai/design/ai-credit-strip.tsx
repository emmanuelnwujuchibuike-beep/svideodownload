"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getCharacterReplaceBalance, readCachedCharacterReplaceBalance } from "@/lib/ai/character-replace/client";
import type { CharacterReplaceBalance, CharacterReplaceFreeAccess } from "@/lib/ai/character-replace/types";
import { formatCents } from "@/lib/ai/economy";
import { readAiFreeAccessCache, writeAiFreeAccessCache } from "@/lib/ai/free-access-cache";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";
import { cn } from "@/lib/utils";

/**
 * THE CREDITS STRIP — "✦ 6 free creations left · AI Balance: … · View credits →"
 *
 * From the owner's reference (2026-10-05) and Brief B §6: one compact row
 * under the showcase, REAL figures only, reusable on every AI page.
 *
 * ── What it shows (nothing invented) ────────────────────────────────────────
 *   · the complimentary creations still left (Part 11 free access), when the
 *     offer is on for this member;
 *   · the AI wallet balance, in the wallet's own currency — it is money, so it
 *     is not called "credits";
 *   · View credits → the existing Credit Balance page (`${base}/usage`)
 *     (label: owner, 2026-10-05 — "change this view balance button to view
 *     dashboard or view credits").
 *
 * ── 🔴 Requests ─────────────────────────────────────────────────────────────
 * It paints from the snapshot this browser already keeps
 * (`readCachedCharacterReplaceBalance`, `readAiFreeAccessCache`), which every
 * page that spends money refreshes on entry. It asks the network ONLY when
 * there is no snapshot at all — so a member moving around AI Studio does not
 * pay one more invocation per page view. A guest never asks.
 *
 * ── 🔴 No layout shift ──────────────────────────────────────────────────────
 * The page is static and cannot know who is looking, so the strip is ALWAYS
 * drawn at its full height: a member sees their figures, a guest sees the
 * sign-in line in the same box. Nothing below it moves when it fills.
 */
export function AiCreditStrip({ base, className }: { base: string; className?: string }) {
  const [who, setWho] = useState<"unknown" | "guest" | "member">("unknown");
  const [balance, setBalance] = useState<CharacterReplaceBalance | null>(null);
  const [free, setFree] = useState<CharacterReplaceFreeAccess | null>(null);

  useEffect(() => {
    if (!hasAuthCookie()) {
      setWho("guest");
      return;
    }
    setWho("member");
    const cached = readCachedCharacterReplaceBalance();
    const cachedFree = readAiFreeAccessCache();
    if (cached) setBalance(cached);
    if (cachedFree) setFree(cachedFree);
    if (cached) return;
    let alive = true;
    void getCharacterReplaceBalance().then((res) => {
      if (!alive || !res.ok) return;
      setBalance(res.balance);
      if (res.balance.freeAccess) {
        setFree(res.balance.freeAccess);
        writeAiFreeAccessCache(res.balance.freeAccess);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const freeLeft = free?.enabled && free.remaining !== null && free.remaining > 0 ? free.remaining : null;

  return (
    <div
      className={cn(
        "flex h-12 items-center gap-2.5 rounded-2xl bg-card px-3.5 text-[13px] ring-1 ring-inset ring-black/[0.07] dark:ring-white/10",
        className,
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
      {who === "guest" ? (
        <>
          <span className="min-w-0 flex-1 truncate text-foreground/80">
            <span className="min-[400px]:hidden">Sign in to create</span>
            <span className="hidden min-[400px]:inline">Sign in to create with Frenz AI</span>
          </span>
          <Link href={`/login?next=${encodeURIComponent(base)}`} className="ai-strip-cta">
            Sign in <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </>
      ) : (
        <>
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate" aria-live="polite">
            {freeLeft !== null ? (
              <>
                <span className="truncate font-medium">
                  {freeLeft} free {freeLeft === 1 ? "creation" : "creations"} left
                </span>
                {balance ? <span className="h-1 w-1 shrink-0 rounded-full bg-indigo-300" aria-hidden /> : null}
              </>
            ) : null}
            {balance ? (
              <span className="truncate text-muted-foreground">
                <span className={cn(freeLeft !== null && "hidden min-[400px]:inline")}>AI Balance: </span>
                <span className="font-medium text-foreground/85 tabular-nums">{formatCents(balance.balanceCents, balance.symbol)}</span>
              </span>
            ) : who === "member" && freeLeft === null ? (
              <span className="text-muted-foreground">Your AI balance</span>
            ) : null}
          </span>
          <Link href={`${base}/usage`} prefetch={false} className="ai-strip-cta">
            View credits <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </>
      )}
    </div>
  );
}

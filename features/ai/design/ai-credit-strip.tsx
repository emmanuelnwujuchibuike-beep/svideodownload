"use client";

import { ArrowRight, Coins } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  BALANCE_EVENT,
  BALANCE_STORAGE_KEY,
  getCharacterReplaceBalance,
  readCachedCharacterReplaceBalance,
} from "@/lib/ai/character-replace/client";
import type { CharacterReplaceBalance, CharacterReplaceFreeAccess } from "@/lib/ai/character-replace/types";
import { FrenzLogo } from "@/components/brand/frenz-logo";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { formatCompactCredits, formatCredits } from "@/lib/ai/credits/units";
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
/**
 * Earn → the daily and weekly quests (owner, 2026-10-07). One definition for the
 * strip's compact pill and the landing's large one (owner, 2026-10-08: "put only
 * the earn button at the top of the landing page where it will be fully
 * noticeable"). Same colours, same destination; `size="lg"` always names itself.
 */
export function EarnButton({ size = "sm", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <TapOnceLink
      href="/quests"
      aria-label="Earn credits"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-gradient-to-r from-amber-400 to-orange-400 font-bold text-white transition-[transform,opacity] duration-200 active:scale-90 data-[pending]:scale-95 data-[pending]:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 motion-reduce:active:scale-100",
        size === "sm"
          ? "h-8 gap-1 px-2.5 text-[12px] shadow-[0_4px_10px_-6px_rgba(249,115,22,0.8)]"
          : size === "md"
            ? // the landing's headline-row pill (owner, 2026-10-08: "too big, make it smaller")
              "h-8 gap-1 px-3 text-[12.5px] shadow-[0_6px_14px_-8px_rgba(249,115,22,0.9)]"
            : "h-12 gap-2 px-5 text-[15px] shadow-[0_12px_26px_-12px_rgba(249,115,22,0.95)] active:scale-95",
        className,
      )}
    >
      <Coins className={size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} aria-hidden />
      {size === "sm" || size === "md" ? <span>Earn</span> : <span>Earn credits</span>}
    </TapOnceLink>
  );
}

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
    /*
      🔴 LIVE, WITHOUT POLLING (Download page refinement, 2026-10-09: "balance
      updates instantly"). Any page that already asks the server for the balance
      writes the snapshot, and that write announces itself — in this tab through
      BALANCE_EVENT, in other tabs through the browser's own `storage` event. So a
      top-up, a spend or a quest reward repaints this strip the moment its own
      page learns of it, and the strip itself never asks again.
    */
    const onBalance = (e: Event) => {
      const next = (e as CustomEvent<CharacterReplaceBalance>).detail;
      if (next) setBalance(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== BALANCE_STORAGE_KEY) return;
      setBalance(readCachedCharacterReplaceBalance());
    };
    window.addEventListener(BALANCE_EVENT, onBalance);
    window.addEventListener("storage", onStorage);
    const unlisten = () => {
      window.removeEventListener(BALANCE_EVENT, onBalance);
      window.removeEventListener("storage", onStorage);
    };
    if (cached) return unlisten;
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
      unlisten();
    };
  }, []);

  const freeLeft = free?.enabled && free.remaining !== null && free.remaining > 0 ? free.remaining : null;

  /*
    ── COMPACT (Download page refinement, 2026-10-09, to the improved reference:
    "Credits card — 10–15% more compact, still easy to tap") ─────────────────
    One container where there were two: the 1 px gradient rim wrapped a frosted
    body with its own blur, inset highlight and a two-layer coloured shadow. Now
    it is a single white card with a hairline ring and one soft shadow — no
    `backdrop-blur` (nothing behind it to blur), no nested box. 56 → 50 px tall
    (−11%), the logo 36 → 32 px. Fixed height for everyone, so filling in after
    hydration still moves nothing.

    The balance is counted in K from 1,000 (owner: "credit should be counted as
    K when it reach 1000") and rounded DOWN, so it never shows more than the
    member holds; the exact figure is in the title and for screen readers.
  */
  return (
    <div
      className={cn(
        "flex h-[3.125rem] items-center gap-2 rounded-[1.125rem] bg-white px-2.5 text-[13px] shadow-[0_6px_18px_-12px_rgba(79,70,229,0.45)] ring-1 ring-inset ring-indigo-100 dark:bg-card dark:ring-white/10",
        className,
      )}
    >
      {/* 2026-10-09 (owner): the Frenzsave logo in this tile, not a sparkle */}
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[0.625rem]">
        <FrenzLogo size={32} tile alt="" className="h-8 w-8 rounded-[0.625rem]" />
      </span>
      {who === "guest" ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-indigo-500/80">Frenz AI</span>
            <span className="block truncate text-[13.5px] font-semibold leading-tight">
              <span className="min-[400px]:hidden">Sign in to create</span>
              <span className="hidden min-[400px]:inline">Sign in to create with Frenz AI</span>
            </span>
          </span>
          <Link href={`/login?next=${encodeURIComponent(base)}`} className="ai-strip-cta">
            Sign in <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1" aria-live="polite">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-indigo-500/80">
              {freeLeft !== null ? (
                <>
                  <span className="truncate">
                    {freeLeft} free {freeLeft === 1 ? "creation" : "creations"}
                  </span>
                  <span className="h-1 w-1 shrink-0 rounded-full bg-indigo-300" aria-hidden />
                </>
              ) : null}
              <span className="shrink-0">AI Credits</span>
            </span>
            <span
              className="block truncate text-[15px] font-bold leading-tight tabular-nums tracking-[-0.01em]"
              title={balance ? formatCredits(balance.balanceCents) : undefined}
            >
              {balance ? (
                <>
                  {/* The unit word yields first on the narrowest phones — the
                      eyebrow above already says AI CREDITS — so the figure never
                      truncates beside Earn and View. */}
                  <span aria-hidden>
                    {formatCompactCredits(balance.balanceCents)}
                    <span className="max-[359px]:hidden"> {Math.abs(Math.round(balance.balanceCents)) === 1 ? "credit" : "credits"}</span>
                  </span>
                  <span className="sr-only">{formatCredits(balance.balanceCents)}</span>
                </>
              ) : who === "member" ? (
                "—"
              ) : (
                " "
              )}
            </span>
          </span>
          {/* 2026-10-07 (owner): "an earn credits button" — the daily and weekly quests */}
          <EarnButton />
          <TapOnceLink href={`${base}/usage`} aria-label="View credits" className="ai-strip-cta data-[pending]:opacity-80">
            View
          </TapOnceLink>
        </>
      )}
    </div>
  );
}

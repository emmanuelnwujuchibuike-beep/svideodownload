"use client";

import { ArrowRight, Coins } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useWallet } from "@/features/ai/wallet/use-wallet";
import { readCachedCharacterReplaceBalance } from "@/lib/ai/character-replace/client";
import type { CharacterReplaceBalance, CharacterReplaceFreeAccess } from "@/lib/ai/character-replace/types";
import { FrenzLogo } from "@/components/brand/frenz-logo";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { formatCredits } from "@/lib/ai/credits/units";
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
          ? "h-9 gap-1 px-2.5 text-[12.5px] shadow-[0_6px_14px_-8px_rgba(249,115,22,0.9)]"
          : size === "md"
            ? // the landing's headline-row pill (owner, 2026-10-08: "too big, make it smaller")
              "h-8 gap-1 px-3 text-[12.5px] shadow-[0_6px_14px_-8px_rgba(249,115,22,0.9)]"
            : "h-12 gap-2 px-5 text-[15px] shadow-[0_12px_26px_-12px_rgba(249,115,22,0.95)] active:scale-95",
        className,
      )}
    >
      <Coins className={size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} aria-hidden />
      {size === "sm" ? <span className="hidden min-[400px]:inline">Earn</span> : size === "md" ? <span>Earn</span> : <span>Earn credits</span>}
    </TapOnceLink>
  );
}

/*
  🔴 NO RELOAD ON ENTRY (owner, 2026-10-09: "the credit page and dashboard reload
  on every entry … it only supposed to revalidate and update instantly when a
  balance update").

  The strip painted an EMPTY first frame on every entry and filled in the cached
  figure one frame later — the visible reload — and once anything was cached it
  never asked again, so a new balance only showed after a reload. Now:
    · after the app has hydrated once, the first frame reads the device snapshot
      synchronously (a client navigation has no server HTML to mismatch);
    · the live figure is the shared wallet (useWallet): one cache key per member,
      updated the moment the member's wallet row changes, never on entry.
*/
let stripHydrated = false;

type Boot = { who: "guest" | "member"; cached: CharacterReplaceBalance | null; free: CharacterReplaceFreeAccess | null };
function readBoot(): Boot {
  if (!hasAuthCookie()) return { who: "guest", cached: null, free: null };
  return { who: "member", cached: readCachedCharacterReplaceBalance(), free: readAiFreeAccessCache() };
}

export function AiCreditStrip({ base, className }: { base: string; className?: string }) {
  const [boot, setBoot] = useState<Boot | null>(() => (stripHydrated ? readBoot() : null));
  const wallet = useWallet();

  useEffect(() => {
    stripHydrated = true;
    setBoot((b) => b ?? readBoot());
  }, []);

  const live = wallet.data?.balance ?? null;
  useEffect(() => {
    if (live?.freeAccess) writeAiFreeAccessCache(live.freeAccess);
  }, [live]);

  const who = boot?.who ?? "unknown";
  const balance = live ?? boot?.cached ?? null;
  const free = live?.freeAccess ?? boot?.free ?? null;

  const freeLeft = free?.enabled && free.remaining !== null && free.remaining > 0 ? free.remaining : null;

  /*
    ── PREMIUM, FLOATING (owner, 2026-10-05: "make this card more glass and
    premium, give a slight shadow so it looks like it floats a little … give
    it more design detailing") ─────────────────────────────────────────────
    · a 1 px gradient RIM (sky → indigo → fuchsia) around a frosted white
      body, with a light top highlight;
    · a soft indigo shadow under it — the float — and a hairline contact
      shadow so it still sits on the page;
    · the sparkle in a small gradient tile; the balance as a quiet label
      over a bold figure; the action as a tinted pill with its own rim.
    One small blurred surface; nothing animates. Fixed 56 px for everyone,
    so filling in after hydration moves nothing.
  */
  return (
    <div
      className={cn(
        "rounded-[1.25rem] bg-gradient-to-r from-sky-200/90 via-indigo-200/80 to-fuchsia-200/80 p-px",
        "shadow-[0_14px_30px_-16px_rgba(79,70,229,0.45),0_2px_6px_-3px_rgba(15,23,42,0.12)]",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-3 rounded-[calc(1.25rem-1px)] bg-white/[0.86] px-2.5 text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur dark:bg-card/90">
        {/* 2026-10-09 (owner): the Frenzsave logo in this tile, not a sparkle */}
        {/* owner 2026-10-09 (later): "Remove this black background from this logo" — the transparent
            Frenzsave logo straight on the card, no tile, no ring, no shadow. */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center">
          <FrenzLogo size={26} alt="" className="h-[26px] w-[26px]" />
        </span>
        {who === "guest" ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-indigo-500/80">Frenz AI</span>
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
              <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-indigo-500/80">
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
              <span className="block truncate text-[15px] font-bold leading-tight tabular-nums tracking-[-0.01em]">
                {balance ? formatCredits(balance.balanceCents) : who === "member" ? "—" : " "}
              </span>
            </span>
            {/* 2026-10-07 (owner): "an earn credits button" — the daily and weekly quests */}
            <EarnButton />
            <TapOnceLink href={`${base}/usage`} className="ai-strip-cta data-[pending]:opacity-80">
              <span className="min-[400px]:hidden">Credits</span>
              <span className="hidden min-[400px]:inline">View credits</span> <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </TapOnceLink>
          </>
        )}
      </div>
    </div>
  );
}

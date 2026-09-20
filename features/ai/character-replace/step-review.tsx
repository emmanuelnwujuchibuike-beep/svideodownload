"use client";

import { AlertTriangle, Check, Plus, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { CharacterReplaceBalanceCard } from "@/features/ai/character-replace/balance-card";
import { CharacterReplaceRechargeSheet } from "@/features/ai/character-replace/recharge-sheet";
import { VideoGenerationCostPreview } from "@/features/ai/character-replace/video-generation-cost-preview";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import { REPLACEMENT_MODE_COPY } from "@/lib/ai/character-replace/modes";
import { affordability } from "@/lib/ai/character-replace/pricing";
import type { CharacterReplaceBalance, CharacterReplaceProject, PricingState } from "@/lib/ai/character-replace/types";
import { formatSeconds, selectedDurationSeconds } from "@/lib/ai/character-replace/workspace";
import { formatCents } from "@/lib/ai/economy";
import { formatResolution } from "@/lib/ai/media";
import { track } from "@/lib/analytics/client";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * Step 5 — review & confirm. The owner's steps 5, 6 and 7 on one screen:
 * the exact price (§8), the balance it comes from, the consent line (§12),
 * and the one button. Separating a price from the button that spends it is
 * how people get surprised, so they are together.
 *
 * ── Part 3, §14 — insufficient balance, as facts ────────────────────────────
 *
 *     Insufficient balance
 *     Required   ₦1,250
 *     Available  ₦800
 *     Short by   ₦450
 *     [Recharge]
 *
 * The three figures are the server's total and the server's balance put side
 * by side by `affordability` — the same pure function the quote route used
 * to answer `sufficient`. Nothing is deducted here (§11); the row under the
 * balance card that reads "After processing" is arithmetic on two numbers
 * the server gave, shown so a member knows what is left before they press
 * Start, and the server does that subtraction itself, later, atomically.
 *
 * The two files are shown small, side by side, so the member confirms WHAT
 * they are about to make and not only how much it costs.
 */
export function CharacterReplaceReviewStep({
  project,
  config,
  pricing,
  balance,
  balanceError,
  topupNotice,
  onDismissTopupNotice,
  onRetryQuote,
  returnTo,
  onConsent,
  rechargeAsk = 0,
}: {
  project: CharacterReplaceProject;
  config: CharacterReplacePublicConfig;
  pricing: PricingState;
  balance: CharacterReplaceBalance | null;
  balanceError: string | null;
  topupNotice: string | null;
  onDismissTopupNotice: () => void;
  onRetryQuote: () => void;
  returnTo: string;
  onConsent: (value: boolean) => void;
  /** Part 9 §13: bumped by the footer's "Recharge to continue" — each bump opens the recharge sheet. */
  rechargeAsk?: number;
}) {
  const consentId = useId();
  const character = project.character;
  const video = project.video;
  const symbol = balance?.symbol ?? config.symbol;
  const mode = REPLACEMENT_MODE_COPY[project.mode];

  const snapshot = pricing.status === "quoted" || pricing.status === "stale" ? pricing.snapshot : null;
  const money = snapshot && balance ? affordability(snapshot.totalCents, balance.balanceCents) : null;
  const short = pricing.status === "quoted" && money !== null && !money.sufficient;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMounted, setSheetMounted] = useState(false);
  const openSheet = useCallback(() => {
    setSheetMounted(true);
    setSheetOpen(true);
  }, []);
  useEffect(() => {
    if (rechargeAsk && rechargeAsk > 0) openSheet();
  }, [rechargeAsk, openSheet]);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  /*
    §20 (the replacement-scope brief): a balance that does not cover the
    price is a product fact worth counting — the scope, the quality and a
    bucket of the shortfall, never an amount tied to a person, never media.
  */
  const shortfall = short && money ? money.shortfallCents : null;
  useEffect(() => {
    if (shortfall === null || !snapshot) return;
    track("character_replace_balance_short", { mode: snapshot.mode, quality: snapshot.quality, shortfallBucket: shortfall < 100 ? "<1" : shortfall < 500 ? "1-5" : shortfall < 2000 ? "5-20" : "20+" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortfall === null, snapshot?.id]);

  return (
    /*
      Part 9 §36: stacked on a phone; on a wide screen what is being made sits
      on the left and the money — price, balance, shortfall — stays put on
      the right while the left scrolls. The consent line stays under the
      money, where the Create button is.
    */
    <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start lg:gap-6 lg:space-y-0">
      <div className="space-y-4">
      {/* ── what is about to be made ────────────────────────────────────── */}
      <div className="rounded-[1.25rem] border border-border/70 bg-card px-4 py-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Replacement</p>
        <p className="mt-0.5 text-[15px] font-bold tracking-[-0.01em]">{mode.label}</p>
        {/* the tagline, not the paragraph — the picker already explained the mode (Part 9 §2: do not overuse text) */}
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{mode.tagline}</p>
      </div>
      {character && video ? (
        <div className="grid grid-cols-2 gap-3">
          <Thumb label={project.references.length ? `Your photos (${project.references.length + 1})` : "Your photo"} sub={formatResolution(character.width, character.height) ?? character.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={character.objectUrl} alt="" className="h-full w-full object-cover" />
          </Thumb>
          <Thumb label="Your video" sub={`${formatSeconds(selectedDurationSeconds(project))}${project.settings.trim ? " kept" : ""}`}>
            <video src={video.objectUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          </Thumb>
        </div>
      ) : null}
      </div>

      <div className="space-y-4 lg:sticky lg:top-24">
      {/* ── the price, live (Part 6 §12): every line, from the server ──── */}
      <VideoGenerationCostPreview project={project} config={config} pricing={pricing} symbol={symbol} onRetry={onRetryQuote} balanceCents={balance?.balanceCents ?? null} />

      <CharacterReplaceBalanceCard
        balance={balance}
        error={balanceError}
        notice={topupNotice}
        onDismissNotice={onDismissTopupNotice}
        onRecharge={openSheet}
      />

      {/* ── the money, side by side (§14; Part 6 §12) ──────────────────── */}
      {short && money && snapshot && balance ? (
        <div role="status" className="rounded-[1.25rem] border border-amber-500/35 bg-amber-500/[0.07] px-4 py-3.5">
          <p className="flex items-center gap-2 text-[13.5px] font-bold">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            You need {formatCents(money.shortfallCents, balance.symbol)} more
          </p>
          <dl className="mt-2.5 space-y-1.5 text-[13.5px]">
            <Row label="Required" value={formatCents(snapshot.totalCents, snapshot.symbol)} />
            <Row label="Character Replace balance" value={formatCents(balance.balanceCents, balance.symbol)} />
            <Row label="Short by" value={formatCents(money.shortfallCents, balance.symbol)} strong />
          </dl>
          <button
            type="button"
            onClick={() => {
              haptic("selection");
              openSheet();
            }}
            className={cn(
              "mt-3 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-bold text-background",
              "transition motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
            )}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Recharge Character Replace
          </button>
        </div>
      ) : null}

      {/* ── consent (§12): professional, unobtrusive, and required ─────────── */}
      <div className="rounded-[1.25rem] border border-border/70 bg-card px-4 py-3.5">
        <label htmlFor={consentId} className="flex cursor-pointer items-start gap-3">
          <input
            id={consentId}
            type="checkbox"
            checked={project.consent}
            onChange={(e) => onConsent(e.target.checked)}
            className="peer sr-only"
          />
          {/* the visible box; the real input above is what the keyboard and the reader use */}
          <span
            aria-hidden
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-background text-background transition",
              "peer-checked:border-foreground peer-checked:bg-foreground",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
            )}
          >
            <Check className={cn("h-3.5 w-3.5 transition-opacity", project.consent ? "opacity-100" : "opacity-0")} strokeWidth={3} />
          </span>
          <span className="text-[13.5px] font-medium leading-snug">
            I confirm that I have permission to use this {project.voice.mode === "new_voice" ? "image, video and voice" : "image and video"}.
          </span>
        </label>
        {/* Part 9 §11: the why, on request — never a document before every video */}
        <details className="group mt-2.5 pl-8 text-[12.5px] leading-relaxed text-muted-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-foreground/80 [&::-webkit-details-marker]:hidden">
            <ShieldCheck className="h-3.5 w-3.5 text-primary/70" aria-hidden />
            What this means
          </summary>
          <p className="mt-1.5">
            Use only photos and videos you own or have permission to use, and only a voice you may use. The result carries a small AI-generated
            note. Frenz AI keeps your files private and removes them on the schedule shown in Video details.
          </p>
        </details>
      </div>

      {sheetMounted && balance ? (
        <CharacterReplaceRechargeSheet
          open={sheetOpen}
          onClose={closeSheet}
          balance={balance}
          returnTo={returnTo}
          suggestedCents={short && money ? money.shortfallCents : null}
        />
      ) : null}
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={cn("text-muted-foreground", strong && "font-semibold text-foreground")}>{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-[15px] font-bold" : "font-semibold")}>{value}</dd>
    </div>
  );
}

function Thumb({ label, sub, children }: { label: string; sub: string; children: React.ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-[1.25rem] border border-border/70 bg-card">
      <div className="aspect-[4/3] bg-[#0b0f1a]">{children}</div>
      <figcaption className="px-3 py-2">
        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{label}</span>
        <span className="mt-0.5 block truncate text-[12.5px] font-semibold tabular-nums" title={sub}>
          {sub}
        </span>
      </figcaption>
    </figure>
  );
}

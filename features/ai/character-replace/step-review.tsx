"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useId } from "react";

import { CharacterReplaceBalanceCard } from "@/features/ai/character-replace/balance-card";
import { CharacterReplacePricingSummary } from "@/features/ai/character-replace/pricing-summary";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { CharacterReplaceBalance, CharacterReplaceProject, PricingState } from "@/lib/ai/character-replace/types";
import { formatSeconds, selectedDurationSeconds, summaryLines, trimmedSeconds } from "@/lib/ai/character-replace/workspace";
import { formatResolution } from "@/lib/ai/media";
import { cn } from "@/lib/utils";

/**
 * Step 5 — review & confirm. The owner's steps 5, 6 and 7 on one screen:
 * the exact price (§8), the balance it comes from, the consent line (§12),
 * and the one button. Separating a price from the button that spends it is
 * how people get surprised, so they are together.
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
  returnTo,
  onConsent,
}: {
  project: CharacterReplaceProject;
  config: CharacterReplacePublicConfig;
  pricing: PricingState;
  balance: CharacterReplaceBalance | null;
  balanceError: string | null;
  topupNotice: string | null;
  onDismissTopupNotice: () => void;
  returnTo: string;
  onConsent: (value: boolean) => void;
}) {
  const consentId = useId();
  const lines = summaryLines(project, config);
  const character = project.character;
  const video = project.video;

  return (
    <div className="space-y-4">
      {/* ── what is about to be made ────────────────────────────────────── */}
      {character && video ? (
        <div className="grid grid-cols-2 gap-3">
          <Thumb label="Your photo" sub={formatResolution(character.width, character.height) ?? character.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={character.objectUrl} alt="" className="h-full w-full object-cover" />
          </Thumb>
          <Thumb label="Your video" sub={`${formatSeconds(selectedDurationSeconds(project))}${project.settings.trim ? " kept" : ""}`}>
            <video src={video.objectUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          </Thumb>
        </div>
      ) : null}

      <CharacterReplaceBalanceCard
        balance={balance}
        error={balanceError}
        notice={topupNotice}
        onDismissNotice={onDismissTopupNotice}
        returnTo={returnTo}
      />

      <CharacterReplacePricingSummary
        lines={lines}
        pricing={pricing}
        trimmed={trimmedSeconds(project)}
        symbol={balance?.symbol ?? config.symbol}
      />

      {/* ── consent (§12): professional, unobtrusive, and required ─────────── */}
      <div className="rounded-[1.25rem] border border-border/70 bg-card px-4 py-3.5">
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden />
          Use only photos and videos you own or have permission to use.
        </p>
        <label htmlFor={consentId} className="mt-3 flex cursor-pointer items-start gap-3">
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
          <span className="text-[13.5px] font-medium leading-snug">I confirm that I have the right to use this likeness and content.</span>
        </label>
      </div>
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

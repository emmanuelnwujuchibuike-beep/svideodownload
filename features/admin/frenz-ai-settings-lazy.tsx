"use client";

import dynamic from "next/dynamic";

import type { CharacterReplaceAdminJob } from "@/lib/ai/admin-job-view";
import type { AiCreditMonitorRow, AiPlansAdminStats } from "@/lib/ai/credits/admin";
import type { PlanSurveySummary } from "@/lib/ai/credits/plan-survey";
import type { AiMoneySummary } from "@/lib/ai/admin-money-view";
import type { AiOperations } from "@/lib/ai/admin-ops-view";
import type { AiPromo } from "@/lib/ai/promo/config";
import type { ShowcaseSlide } from "@/lib/ai/showcase/slides";
import type { LipSyncAdminStats } from "@/lib/ai/lip-sync/admin";
import type { TextToAudioAdminStats } from "@/lib/ai/text-to-audio/admin";
import type { VoiceCloneAdminStats } from "@/lib/ai/voice-clone/admin";
import type { LandingSettings } from "@/lib/landing/settings";

/*
  🔴 CODE-SPLIT, and the route budget is why (lib/perf/budget.test.ts).

  The Frenz AI panels are among the largest client panels on /admin — the
  allowances, the pricing, the currency, the Character Replace pricing form —
  and that route renders every panel eagerly. Its ceiling note says the answer
  to the next overflow is splitting the panels rather than raising the number
  again; this is that split.

  ⚠️ The split has to happen INSIDE a client component. A `next/dynamic` call
  from the server page was tried first and moved nothing: a client boundary
  referenced by a page is bundled into that page's client chunk regardless.
  From here, each form is a real lazy chunk, fetched when its wrapper mounts
  — and since the AI section became tabbed (owner, 2026-09-14: "horizontal
  NAV and button for each section"), a chunk is fetched only when its tab is
  first opened. Same pattern as `use-sensitive-action.tsx`.

  The placeholders keep the section's height steady for the ~100 ms a chunk
  takes on a warm cache, so nothing below them jumps.
*/
/*
  🔴 IT HAS TO LOOK LIKE IT IS ARRIVING (owner, 2026-09-27: "Sections in the
  admin dashboard doesn't load or takes time to load, it shows white").

  This was a single static `bg-card` box, 28rem tall. `bg-card` IS white on the
  light theme, so every one of the nine lazy tabs below — Frenz AI settings,
  pricing, balances, processing, plans, providers, Lip Sync, Text to Audio,
  Voice Cloning — opened as a large blank white rectangle with no motion and no
  edges to read. That is indistinguishable from a section that failed to load,
  which is precisely how it was reported.

  Now the same pulsing bars `PanelSkeleton` uses on the page itself
  (app/admin/page.tsx). The height is preserved so nothing below jumps when the
  real panel lands; only the emptiness goes.
*/
const skeleton = (label: string) =>
  function Skeleton() {
    return (
      <div className="min-h-[28rem] space-y-4" aria-busy="true" aria-label={label}>
        <div className="h-28 animate-pulse rounded-2xl bg-secondary/60" />
        <div className="h-56 animate-pulse rounded-2xl bg-secondary/40" />
        <div className="h-24 animate-pulse rounded-2xl bg-secondary/30" />
      </div>
    );
  };

const FrenzAISettings = dynamic(() => import("@/features/admin/frenz-ai-settings").then((m) => m.FrenzAISettings), {
  loading: skeleton("Loading Frenz AI settings"),
});
const CharacterReplacePricingPanel = dynamic(
  () => import("@/features/admin/character-replace-pricing").then((m) => m.CharacterReplacePricingPanel),
  { loading: skeleton("Loading Character Replace pricing") },
);
const AiBalanceAdjustPanel = dynamic(() => import("@/features/admin/ai-balance-adjust").then((m) => m.AiBalanceAdjustPanel), {
  loading: skeleton("Loading balance adjustments"),
});
// 0166: AI → Processing — concurrency, the queue, retries, refunds (its own tab, its own chunk).
const CharacterReplaceProcessingPanel = dynamic(() => import("@/features/admin/character-replace-processing").then((m) => m.CharacterReplaceProcessingPanel), {
  loading: skeleton("Loading processing settings"),
});

export function FrenzAISettingsLazy({ settings }: { settings: LandingSettings }) {
  return <FrenzAISettings settings={settings} />;
}

export function CharacterReplacePricingLazy({ settings }: { settings: LandingSettings }) {
  return <CharacterReplacePricingPanel settings={settings} />;
}

export function AiBalanceAdjustLazy({ settings }: { settings: LandingSettings }) {
  return <AiBalanceAdjustPanel settings={settings} />;
}

export function CharacterReplaceProcessingLazy({ settings }: { settings: LandingSettings }) {
  return <CharacterReplaceProcessingPanel settings={settings} />;
}

// 0167: AI Plans & Credits — its own tab, its own chunk (the panel runs the credit engine and the pricing engine for its live example).
const AiPlansSettingsPanel = dynamic(() => import("@/features/admin/ai-plans-settings").then((m) => m.AiPlansSettingsPanel), { loading: skeleton("Loading AI plans") });

export function AiPlansSettingsLazy({ settings }: { settings: LandingSettings }) {
  return <AiPlansSettingsPanel settings={settings} />;
}

/*
  The two MONITORS are client components since 2026-09-21 (filter chips) and
  render on the first tab, so they would otherwise sit in /admin's first-load
  JS — the route budget (lib/perf/budget.test.ts) caught the job table doing
  exactly that. As lazy chunks they are fetched right after hydration and
  weigh nothing on the route itself; the rows are server-read props either way.
*/
const CharacterReplaceJobsTable = dynamic(() => import("@/features/admin/character-replace-jobs").then((m) => m.CharacterReplaceJobsTable), { loading: skeleton("Loading Character Replace jobs") });
const AiCreditsMonitor = dynamic(() => import("@/features/admin/ai-credits-monitor").then((m) => m.AiCreditsMonitor), { loading: skeleton("Loading AI usage") });

export function CharacterReplaceJobsTableLazy({ jobs, symbol }: { jobs: CharacterReplaceAdminJob[]; symbol: string }) {
  return <CharacterReplaceJobsTable jobs={jobs} symbol={symbol} />;
}

// Lip Sync Pro (2026-09-21): AI → Lip Sync — the provider switch (Replicate | fal.ai Sync-3), the models, the two speech sources, the prices, the numbers.
const LipSyncSettingsPanel = dynamic(() => import("@/features/admin/lip-sync-settings").then((m) => m.LipSyncSettingsPanel), { loading: skeleton("Loading Lip Sync Pro") });

export function LipSyncSettingsLazy(props: { settings: LandingSettings; stats: LipSyncAdminStats | null; voices: { id: string; label: string; provider: string }[]; languages: { code: string; label: string }[] }) {
  return <LipSyncSettingsPanel {...props} />;
}

// Text to Audio (2026-09-21): AI → Text to Audio — the route switch (direct ElevenLabs API | Replicate), the model, the prices, the monthly free characters, the numbers.
const TextToAudioSettings = dynamic(() => import("@/features/admin/text-to-audio-settings").then((m) => m.TextToAudioSettingsPanel), { loading: skeleton("Loading Text to Audio") });

export function TextToAudioSettingsLazy(props: { settings: LandingSettings; stats: TextToAudioAdminStats | null; voices: { id: string; label: string; provider: string }[]; languages: { code: string; label: string }[] }) {
  return <TextToAudioSettings {...props} />;
}

// Kling pricing (2026-09-28, Part 4): the unit matrix — what Kling charges us, what the member pays, and the tiers whose cost is not yet measured.
const KlingPricingSettings = dynamic(() => import("@/features/admin/kling-pricing-settings").then((m) => m.KlingPricingSettingsPanel), { loading: skeleton("Loading Kling pricing") });

export function KlingPricingSettingsLazy(props: { settings: LandingSettings }) {
  return <KlingPricingSettings {...props} />;
}

// Voice Cloning (2026-09-27): AI → Voice Cloning — the slots, the price, the recordings, the consent wording, the live-voice figures.
const VoiceCloneSettings = dynamic(() => import("@/features/admin/voice-clone-settings").then((m) => m.VoiceCloneSettingsPanel), { loading: skeleton("Loading Voice Cloning") });

export function VoiceCloneSettingsLazy(props: { settings: LandingSettings; stats: VoiceCloneAdminStats | null }) {
  return <VoiceCloneSettings {...props} />;
}

// Redesign Phase 1 (2026-10-05): AI → Welcome showcase — the carousel's slides, with a live preview using the real card.
const AiShowcaseEditor = dynamic(() => import("@/features/admin/ai-showcase-editor").then((m) => m.AiShowcaseEditor), { loading: skeleton("Loading the welcome showcase") });

export function AiShowcaseEditorLazy({ initial }: { initial: ShowcaseSlide[] | null }) {
  return <AiShowcaseEditor initial={initial} />;
}

// Part 8 (2026-10-07): AI → Overview — the operations panel (cards, grouped failures, every tool's jobs).
const AiOperationsPanel = dynamic(() => import("@/features/admin/ai-operations-panel").then((m) => m.AiOperationsPanel), { loading: skeleton("Loading AI operations") });

export function AiOperationsPanelLazy(props: { ops: AiOperations; labels: Record<string, string>; kling: "healthy" | "degraded" | "unavailable" | "unknown"; currencySymbol: string }) {
  return <AiOperationsPanel {...props} />;
}

// Credit brief §18 (2026-10-07): AI → Overview — top-ups, revenue, credits spent and refunded, by tool and by member.
const AiMoneyPanel = dynamic(() => import("@/features/admin/ai-money-panel").then((m) => m.AiMoneyPanel), { loading: skeleton("Loading AI money") });

export function AiMoneyPanelLazy(props: { money: AiMoneySummary; labels: Record<string, string>; survey?: (PlanSurveySummary & { capped: boolean }) | null }) {
  return <AiMoneyPanel {...props} />;
}

// Brief C (2026-10-06): AI → Landing promotion — the Frenz AI tile on the landing page.
const AiPromoEditor = dynamic(() => import("@/features/admin/ai-promo-editor").then((m) => m.AiPromoEditor), { loading: skeleton("Loading the landing promotion") });

export function AiPromoEditorLazy({ initial }: { initial: AiPromo | null }) {
  return <AiPromoEditor initial={initial} />;
}

export function AiCreditsMonitorLazy({ rows, stats, symbol }: { rows: AiCreditMonitorRow[]; stats: AiPlansAdminStats | null; symbol: string }) {
  return <AiCreditsMonitor rows={rows} stats={stats} symbol={symbol} />;
}

// Rewards brief part 1 (2026-10-07): AI → Rewards — the reward rules, referral analytics, the manual withdrawal queue.
const RewardsPanel = dynamic(() => import("@/features/admin/rewards-panel").then((m) => m.RewardsPanel), { loading: skeleton("Loading rewards") });

export function RewardsPanelLazy({ settings }: { settings: LandingSettings }) {
  return <RewardsPanel settings={settings} />;
}

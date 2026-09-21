"use client";

import dynamic from "next/dynamic";

import type { CharacterReplaceAdminJob } from "@/lib/ai/admin-job-view";
import type { AiProvidersPanelProps } from "@/features/admin/ai-providers-settings";
import type { AiCreditMonitorRow, AiPlansAdminStats } from "@/lib/ai/credits/admin";
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
const skeleton = (label: string) =>
  function Skeleton() {
    return <div aria-busy="true" aria-label={label} className="min-h-[28rem] rounded-3xl border border-border bg-card" />;
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

// 2026-09-21 (the fal.ai brief §10, §20, §26, §27): the provider switch, the models, health, the comparison — one chunk, fetched when the tab opens.
const AiProvidersPanel = dynamic(() => import("@/features/admin/ai-providers-settings").then((m) => m.AiProvidersPanel), { loading: skeleton("Loading providers") });

export function AiProvidersPanelLazy(props: AiProvidersPanelProps) {
  return <AiProvidersPanel {...props} />;
}

export function AiCreditsMonitorLazy({ rows, stats, symbol }: { rows: AiCreditMonitorRow[]; stats: AiPlansAdminStats | null; symbol: string }) {
  return <AiCreditsMonitor rows={rows} stats={stats} symbol={symbol} />;
}

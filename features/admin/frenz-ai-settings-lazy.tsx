"use client";

import dynamic from "next/dynamic";

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

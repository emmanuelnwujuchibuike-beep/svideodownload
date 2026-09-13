"use client";

import dynamic from "next/dynamic";

import type { LandingSettings } from "@/lib/landing/settings";

/*
  🔴 CODE-SPLIT, and the route budget is why (lib/perf/budget.test.ts).

  The Frenz AI settings form is one of the largest client panels on /admin —
  the allowances, the pricing, the currency, and since 2026-09-13 the
  Character Replace block — and that route renders every panel eagerly. Its
  ceiling note says the answer to the next overflow is splitting the panels
  rather than raising the number again; this is that split, for the panel
  that crossed the line (by 335 bytes).

  ⚠️ The split has to happen INSIDE a client component. A `next/dynamic` call
  from the server page was tried first and moved nothing: a client boundary
  referenced by a page is bundled into that page's client chunk regardless.
  From here, the form is a real lazy chunk, fetched when this wrapper mounts
  — immediately for an operator on the AI section, and never counted in the
  route's first load. Same pattern as `use-sensitive-action.tsx`.

  The placeholder keeps the section's height steady for the ~100 ms the
  chunk takes on a warm cache, so nothing below it jumps.
*/
const FrenzAISettings = dynamic(() => import("@/features/admin/frenz-ai-settings").then((m) => m.FrenzAISettings), {
  loading: () => <div aria-busy="true" aria-label="Loading Frenz AI settings" className="min-h-[40rem] rounded-3xl border border-border bg-card" />,
});

export function FrenzAISettingsLazy({ settings }: { settings: LandingSettings }) {
  return <FrenzAISettings settings={settings} />;
}

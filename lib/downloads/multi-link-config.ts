/**
 * Multi-Link Batch Downloader — the PURE half of its configuration.
 *
 * 🔴 Deliberately free of every server-only import (no `@/lib/supabase/*`, no
 * `server-only`). The admin editor, the panel and the source cards are all
 * `"use client"`, and they all need these types/defaults/limits. A client
 * component importing a module that transitively reaches `server-only` breaks
 * `next build` while `tsc --noEmit` stays green — the exact trap that cost a
 * build on the Discovery Orbit rail (lib/social/orbits-catalogue.ts exists for
 * the same reason). The server half lives in `./multi-link.ts` and re-exports
 * everything here, so a server caller still has one import.
 */

export interface MultiLinkSettings {
  /** Master switch. Off = the "＋ Multiple Links" control is not rendered at all. */
  enabled: boolean;
  /** Source URLs a free member may put in one batch. */
  freeSourceLimit: number;
  /** Source URLs a Pro/Business member may put in one batch. */
  proSourceLimit: number;
  /** Batch sessions a free member may complete per UTC day. */
  freeDailyBatches: number;
  /** Whether a completed rewarded ad is required before a free batch downloads. */
  rewardRequired: boolean;
  /** Whether Pro/Business skip the reward ad. Off = everyone watches. */
  proSkipsReward: boolean;
  /** How many source URLs are extracted at once. */
  fetchConcurrency: number;
  /** Copy shown to a free member who has filled every source slot. */
  upsellMessage: string;
}

export const DEFAULT_MULTI_LINK: MultiLinkSettings = {
  enabled: true,
  freeSourceLimit: 3,
  proSourceLimit: 6,
  freeDailyBatches: 2,
  rewardRequired: true,
  proSkipsReward: true,
  fetchConcurrency: 2,
  upsellMessage:
    "Pro supports up to 6 sources per batch with unlimited batch downloads and no reward ads.",
};

/**
 * The hard ceiling on items in one batch, at every tier.
 *
 * NOT a monetization lever — it is `MAX_ITEMS.batch` in
 * `lib/monetization/reward-sessions.ts` and the `.max(50)` on
 * `/api/rewards/download/start`'s zod schema, both of which would reject a
 * 51-item batch outright. Pinned here as a named constant so the picker can
 * stop the member at a number the reward flow will actually accept, instead of
 * letting them select 80 items and meet a 400 at the moment they press
 * Download. Raising it means raising all three together.
 */
export const MAX_BATCH_ITEMS = 50;

/**
 * How many sources this plan may submit.
 *
 * The single definition, used by BOTH the client (to draw the right number of
 * slots) and the server (to refuse a forged request). Duplicating the rule per
 * side is how a client that says 3 ends up talking to a server that allows 100.
 */
export function sourceLimitFor(
  plan: "free" | "pro" | "business",
  settings: MultiLinkSettings = DEFAULT_MULTI_LINK,
): number {
  return plan === "free" ? settings.freeSourceLimit : settings.proSourceLimit;
}

/** Whether this plan must watch a rewarded ad before its batch downloads. */
export function rewardRequiredFor(
  plan: "free" | "pro" | "business",
  settings: MultiLinkSettings = DEFAULT_MULTI_LINK,
): boolean {
  if (!settings.rewardRequired) return false;
  if (plan !== "free" && settings.proSkipsReward) return false;
  return true;
}

/**
 * Daily batch allowance for this plan. `null` means unlimited — Pro and
 * Business are never counted, so their allowance is never read or spent.
 */
export function dailyBatchLimitFor(
  plan: "free" | "pro" | "business",
  settings: MultiLinkSettings = DEFAULT_MULTI_LINK,
): number | null {
  return plan === "free" ? settings.freeDailyBatches : null;
}

/** The shape `/api/downloads/batch/policy` answers with. */
export interface BatchPolicy {
  enabled: boolean;
  plan: "free" | "pro" | "business";
  sourceLimit: number;
  maxItems: number;
  rewardRequired: boolean;
  /** null = unlimited (Pro/Business). */
  dailyLimit: number | null;
  /** Batches already spent today. Always 0 when `dailyLimit` is null. */
  used: number;
  /** null = unlimited. */
  remaining: number | null;
  fetchConcurrency: number;
  upsellMessage: string;
}

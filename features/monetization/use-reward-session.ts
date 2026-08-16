"use client";

import { useCallback } from "react";

import type { AnalyticsEventType } from "@/lib/analytics/types";
import type { RewardType } from "@/lib/monetization/reward-sessions";
import type { MediaKind } from "@/types";

export interface RewardSessionItem {
  url: string;
  formatId: string;
  kind: MediaKind;
  title?: string;
}

interface StartResponse {
  rewardSessionId: string;
  expiresAt: string;
}
interface CompleteResponse {
  rewardSessionId: string;
  items: RewardSessionItem[];
}
interface ApiErrorBody {
  error: string;
  code: string;
}

export class RewardSessionClientError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RewardSessionClientError";
    this.code = code;
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<T & ApiErrorBody>;
  if (!res.ok) {
    const err = json as Partial<ApiErrorBody>;
    throw new RewardSessionClientError(err.code ?? "INTERNAL", err.error ?? "Something went wrong.");
  }
  return json as T;
}

/** Dynamically imported so the analytics client stays out of this bundle's
 *  initial chunk — same pattern as `features/monetization/rewarded-ad.tsx`. */
function track(type: AnalyticsEventType, props?: Record<string, unknown>) {
  void import("@/lib/analytics/client").then((m) => m.track(type, props));
}

/*
  Per-type event names, not a chain of ternaries (fixed 2026-08-16 alongside
  adding the `preview` reward type for the GPT video-preview flow) — a binary
  `type === "hd" ? … : …` silently routed anything that wasn't literally "hd"
  into the "batch" events, which would have mislabelled every preview event.
*/
const EVENTS: Record<RewardType, { started: AnalyticsEventType; granted: AnalyticsEventType; failed: AnalyticsEventType; limitReached: AnalyticsEventType }> = {
  hd: {
    started: "download_hd_reward_started",
    granted: "download_hd_reward_granted",
    failed: "download_hd_reward_failed",
    limitReached: "download_hd_limit_reached",
  },
  batch: {
    started: "download_batch_reward_started",
    granted: "download_batch_reward_granted",
    failed: "download_batch_reward_failed",
    limitReached: "download_batch_limit_reached",
  },
  preview: {
    started: "download_preview_reward_started",
    granted: "download_preview_reward_granted",
    failed: "download_preview_reward_failed",
    limitReached: "download_preview_limit_reached",
  },
};

/**
 * Client wrapper over the reward-session API
 * (lib/monetization/reward-sessions.ts) — Parts 9-10 of the reward-download
 * spec, extended 2026-08-16 with the `"preview"` type for the GPT video-
 * preview reward. `start` opens a session for the exact items about to be
 * ad-gated; `complete` reports that the ad UI granted a reward and returns
 * the server-authorized items, to be redeemed via
 * `/api/download?rewardToken=...&itemIndex=...` (never re-sent as plain
 * url/formatId — the server ignores those in favor of what it stored).
 */
export function useRewardSession() {
  const start = useCallback(async (type: RewardType, items: RewardSessionItem[]) => {
    track(EVENTS[type].started, { count: items.length });
    try {
      return await postJson<StartResponse>("/api/rewards/download/start", { type, items });
    } catch (e) {
      track(EVENTS[type].failed, { code: e instanceof RewardSessionClientError ? e.code : "INTERNAL" });
      throw e;
    }
  }, []);

  const complete = useCallback(async (type: RewardType, rewardSessionId: string) => {
    try {
      const result = await postJson<CompleteResponse>("/api/rewards/download/complete", { rewardSessionId });
      track(EVENTS[type].granted, { rewardSessionId });
      return result;
    } catch (e) {
      const code = e instanceof RewardSessionClientError ? e.code : "INTERNAL";
      track(EVENTS[type].failed, { code });
      if (code === "DAILY_LIMIT_REACHED") track(EVENTS[type].limitReached, {});
      throw e;
    }
  }, []);

  return { start, complete };
}

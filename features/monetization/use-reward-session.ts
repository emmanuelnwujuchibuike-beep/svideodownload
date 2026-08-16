"use client";

import { useCallback } from "react";

import type { AnalyticsEventType } from "@/lib/analytics/types";
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

/**
 * Client wrapper over the reward-session API
 * (lib/monetization/reward-sessions.ts) — Parts 9-10 of the reward-download
 * spec. `start` opens a session for the exact items about to be ad-gated;
 * `complete` reports that the ad UI granted a reward and returns the
 * server-authorized items, to be redeemed via
 * `/api/download?rewardToken=...&itemIndex=...` (never re-sent as plain
 * url/formatId — the server ignores those in favor of what it stored).
 */
export function useRewardSession() {
  const start = useCallback(async (type: "hd" | "batch", items: RewardSessionItem[]) => {
    track(type === "hd" ? "download_hd_reward_started" : "download_batch_reward_started", {
      count: items.length,
    });
    try {
      return await postJson<StartResponse>("/api/rewards/download/start", { type, items });
    } catch (e) {
      track(type === "hd" ? "download_hd_reward_failed" : "download_batch_reward_failed", {
        code: e instanceof RewardSessionClientError ? e.code : "INTERNAL",
      });
      throw e;
    }
  }, []);

  const complete = useCallback(async (type: "hd" | "batch", rewardSessionId: string) => {
    try {
      const result = await postJson<CompleteResponse>("/api/rewards/download/complete", { rewardSessionId });
      track(type === "hd" ? "download_hd_reward_granted" : "download_batch_reward_granted", { rewardSessionId });
      return result;
    } catch (e) {
      const code = e instanceof RewardSessionClientError ? e.code : "INTERNAL";
      track(type === "hd" ? "download_hd_reward_failed" : "download_batch_reward_failed", { code });
      if (code === "DAILY_LIMIT_REACHED") {
        track(type === "hd" ? "download_hd_limit_reached" : "download_batch_limit_reached", {});
      }
      throw e;
    }
  }, []);

  return { start, complete };
}

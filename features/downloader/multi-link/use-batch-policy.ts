"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_MULTI_LINK, MAX_BATCH_ITEMS, type BatchPolicy } from "@/lib/downloads/multi-link-config";

/**
 * The caller's real, server-resolved batch policy (§19: never trust a
 * client-side `isPro`).
 *
 * ── The optimistic default, and why it is safe ────────────────────────────
 * Until `/policy` answers, the panel draws the FREE limits from
 * `DEFAULT_MULTI_LINK`. That is the opposite of the optimism `preview-card.tsx`
 * uses for its select cap, and deliberately so: there, being pessimistic would
 * tell a paying member to upgrade (the worst false positive on that screen);
 * here, being optimistic would draw six source slots for a free member and
 * then refuse the batch at `/authorize` after they had filled them all.
 *
 * Neither choice grants anything either way — `authorizeBatch` re-derives every
 * limit server-side regardless of what the panel drew. This only decides which
 * shape someone sees for the few hundred milliseconds before the truth lands,
 * and "gains a slot" is a far better surprise than "loses the work you did".
 */
export function useBatchPolicy(enabled: boolean) {
  const [policy, setPolicy] = useState<BatchPolicy | null>(null);
  const [ready, setReady] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/downloads/batch/policy", { cache: "no-store" });
      if (!res.ok) return;
      setPolicy((await res.json()) as BatchPolicy);
    } catch {
      /* keep the conservative default — the server decides at authorize time */
    } finally {
      inFlight.current = false;
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const effective: BatchPolicy = policy ?? {
    enabled: true,
    plan: "free",
    sourceLimit: DEFAULT_MULTI_LINK.freeSourceLimit,
    maxItems: MAX_BATCH_ITEMS,
    rewardRequired: DEFAULT_MULTI_LINK.rewardRequired,
    dailyLimit: DEFAULT_MULTI_LINK.freeDailyBatches,
    used: 0,
    remaining: DEFAULT_MULTI_LINK.freeDailyBatches,
    fetchConcurrency: DEFAULT_MULTI_LINK.fetchConcurrency,
    upsellMessage: DEFAULT_MULTI_LINK.upsellMessage,
  };

  /** Reflect a just-spent batch immediately, so the "N remaining today"
   *  indicator is right without waiting on a refetch. */
  const spendLocally = useCallback(() => {
    setPolicy((p) =>
      p && p.remaining !== null
        ? { ...p, used: p.used + 1, remaining: Math.max(0, p.remaining - 1) }
        : p,
    );
  }, []);

  return { policy: effective, ready, refresh, spendLocally };
}

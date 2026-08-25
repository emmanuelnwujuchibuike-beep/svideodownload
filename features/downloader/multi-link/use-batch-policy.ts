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
/**
 * The localStorage mirror of the server-minted browser id (owner, 2026-08-25:
 * "browser id and local storage so it doesnt glitch on anonymous users").
 *
 * The httpOnly cookie is the authoritative identity and is invisible to this
 * code — so the SERVER echoes the id back and this keeps a copy. When the
 * cookie is missing (ITP capping a non-Secure cookie, a PWA relaunching with a
 * cold cookie jar, a privacy extension), the mirror is sent back and the server
 * restores both the identity and the cookie. Without it the visitor would look
 * brand new and their remaining count would visibly jump back to full.
 *
 * Display/recovery only — never read as truth. The server decides.
 */
const ANON_MIRROR_KEY = "frenz.batch.aid";

function readAnonMirror(): string | null {
  try {
    return localStorage.getItem(ANON_MIRROR_KEY);
  } catch {
    return null; // private mode, storage disabled — the cookie still works
  }
}

function writeAnonMirror(id: string | null | undefined): void {
  if (!id) return;
  try {
    localStorage.setItem(ANON_MIRROR_KEY, id);
  } catch {
    /* nothing to recover with, but nothing breaks either */
  }
}

/** The mirror to send with a batch request body, when there is one. */
export function batchAnonMirror(): string | undefined {
  return readAnonMirror() ?? undefined;
}

export function useBatchPolicy(enabled: boolean) {
  const [policy, setPolicy] = useState<BatchPolicy | null>(null);
  const [ready, setReady] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const mirror = readAnonMirror();
      const res = await fetch(
        `/api/downloads/batch/policy${mirror ? `?a=${encodeURIComponent(mirror)}` : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as BatchPolicy & { anonId?: string | null };
      writeAnonMirror(json.anonId);
      setPolicy(json);
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

  /**
   * Adopt the counts the COMMIT response already returned.
   *
   * 🔴 Replaces an optimistic decrement followed by a `refresh()` (owner,
   * 2026-08-25: "it showed 1 and then change back to 2"). That pattern has a
   * race built into it: the local guess paints 1, then a second round trip
   * re-reads the allowance and whatever it says wins — so any disagreement
   * shows up as the number visibly flipping back in front of the visitor,
   * which is worse than never having moved.
   *
   * `/commit` already counts and returns `used`/`remaining` from the same
   * query `/policy` would run. Using them is exactly one source of truth, one
   * network call, and nothing to race.
   */
  const applyCommit = useCallback((counts: { used?: number; remaining?: number | null }) => {
    setPolicy((p) => {
      if (!p) return p;
      if (typeof counts.used !== "number") return p;
      return { ...p, used: counts.used, remaining: counts.remaining ?? null };
    });
  }, []);

  return { policy: effective, ready, refresh, applyCommit };
}

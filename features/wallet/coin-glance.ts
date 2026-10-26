"use client";

import { useEffect, useState } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";

/*
  The member's Frenz Coin balance for the wallet ENTRY POINTS (the /downloads header pill, the profile menu card, the
  chat's Send Frenz Coin) — Part 5, owner 2026-10-25.

  Cost rules (Part 5 performance brief):
  · Nothing at all while Frenz Coin is off: the switch rides on /api/me, which every member already reads once a
    session (useEntitlements) — no request is made just to learn it is off.
  · One shared read for every entry point on screen: module memory, deduplicated while in flight.
  · Kept for 2 minutes; older than that it is shown as it is and re-read ONCE in the background when an entry point
    mounts (never on a timer, never while the tab is hidden). A money action calls `invalidateCoinGlance()`.
  · Display only — the wallet page and every coin route read the real balance again.
  · Memory only: a member's balance is never written to storage.
*/

type Glance = { availableCents: number; walletNumber: string | null };
const FRESH_MS = 2 * 60_000;

let kept: { value: Glance; at: number } | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<(g: Glance | null) => void>();

function load(): Promise<void> {
  inflight ??= fetch("/api/coin/wallet", { cache: "no-store", credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { enabled?: boolean; availableCents?: number; walletNumber?: string | null } | null) => {
      if (d && d.enabled && typeof d.availableCents === "number") {
        kept = { value: { availableCents: d.availableCents, walletNumber: d.walletNumber ?? null }, at: Date.now() };
        for (const l of listeners) l(kept.value);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Read the balance if Frenz Coin is on and what is kept is missing or older than 2 minutes — otherwise nothing.
 * Concurrent callers share one request. Returns whether a request was started.
 */
export function refreshCoinGlanceIfStale(coinOn: boolean, now = Date.now()): boolean {
  if (!coinOn) return false;
  if (kept && now - kept.at <= FRESH_MS) return false;
  if (typeof document !== "undefined" && document.hidden) return false;
  if (inflight) return false;
  void load();
  return true;
}

/** What the entry points show right now (null = nothing). */
export const keptCoinGlance = () => kept?.value ?? null;

/** After a deposit, transfer or withdrawal: the next entry point to mount re-reads. */
export function invalidateCoinGlance() {
  if (kept) kept = { ...kept, at: 0 };
}

/** The balance for an entry point, or null (Frenz Coin off, signed out, or not loaded yet — render nothing). */
export function useCoinGlance(): Glance | null {
  const { frenzCoin, ready } = useEntitlements();
  const [value, setValue] = useState<Glance | null>(() => kept?.value ?? null);
  useEffect(() => {
    if (!ready || !frenzCoin) return;
    listeners.add(setValue);
    if (kept) setValue(kept.value);
    refreshCoinGlanceIfStale(true);
    return () => {
      listeners.delete(setValue);
    };
  }, [ready, frenzCoin]);
  return ready && frenzCoin ? value : null;
}

/** Test hook. */
export function _resetCoinGlance() {
  kept = null;
  inflight = null;
  listeners.clear();
}

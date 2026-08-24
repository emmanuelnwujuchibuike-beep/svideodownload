"use client";

import { mutate, useQuery } from "@/features/data";
import type { StreakState } from "@/lib/streaks/types";

/**
 * The client's single view of the streak. Every component reads THIS — the hero
 * chip, the celebration, the profile card — so none of them can hold a
 * different idea of the number.
 *
 * ── Why the existing data layer and not a new store ──────────────────────
 * `features/data`'s `useQuery` already gives cache-first rendering, request
 * dedup (five components mounting = ONE fetch) and cross-component
 * invalidation. A bespoke streak store would re-implement all three and add
 * bytes to the landing page, which has a 270 kB budget. `STREAK_KEY` is the
 * whole integration.
 */

export const STREAK_KEY = "streak";

/** Display-only cache, so the hero chip can paint before the network answers. */
const CACHE_KEY = "frenz:streak-display";

interface DisplayCache {
  current: number;
  /** Local day the cache was written, so a stale overnight value is ignored. */
  day: string;
}

/**
 * 🔴 DISPLAY CACHE ONLY — NEVER AUTHORITATIVE.
 *
 * §18 forbids trusting localStorage for streak calculations, and this does not:
 * the number here is painted, never counted. Every increment, celebration and
 * restore decision is made by the server from server time. Editing this value
 * changes a chip until the first response arrives, and nothing else.
 */
export function readDisplayCache(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DisplayCache;
    if (typeof parsed?.current !== "number" || typeof parsed?.day !== "string") return null;
    // A cache written on a previous day says nothing about today — the streak
    // may have advanced or broken overnight. Better a chip that appears late
    // than one that shows a number the server is about to contradict.
    const today = new Date().toLocaleDateString("en-CA");
    return parsed.day === today ? parsed.current : null;
  } catch {
    return null;
  }
}

function writeDisplayCache(state: StreakState): void {
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ current: state.currentStreak, day: state.today } satisfies DisplayCache),
    );
  } catch {
    /* private mode — the chip just waits for the network */
  }
}

async function loadStreak(): Promise<StreakState> {
  const res = await fetch("/api/streak", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`streak ${res.status}`);
  const state = (await res.json()) as StreakState;
  writeDisplayCache(state);
  return state;
}

/**
 * Read the streak. Never throws into the tree and never blocks anything — a
 * failed fetch simply leaves `data` undefined and every consumer renders
 * nothing (§24: the page must stay usable when the service is not).
 */
export function useStreak() {
  return useQuery<StreakState>(STREAK_KEY, loadStreak, {
    // A streak changes at most once a day. Re-asking on every window focus is
    // pure noise on a PWA that gets focused dozens of times.
    revalidateOnFocus: false,
  });
}

/** Publish a freshly-computed state to every mounted consumer at once. */
export function publishStreak(state: StreakState): void {
  writeDisplayCache(state);
  mutate<StreakState>(STREAK_KEY, () => state);
}

/**
 * Record today's activity. Idempotent server-side, so calling it from more than
 * one place (or more than one tab) is safe by construction.
 */
export async function recordStreakActivity(): Promise<StreakState | null> {
  try {
    const res = await fetch("/api/streak", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // The only thing the client is allowed to assert. The server decides
        // what day that makes it.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    if (!res.ok) return null;
    const state = (await res.json()) as StreakState;
    publishStreak(state);
    return state;
  } catch {
    return null;
  }
}

export async function markStreakCelebrated(): Promise<void> {
  try {
    const res = await fetch("/api/streak/celebrated", { method: "POST", credentials: "same-origin" });
    if (res.ok) publishStreak((await res.json()) as StreakState);
  } catch {
    /* the server-side date is what actually gates the replay; this is the write */
  }
}

export async function restoreStreak(): Promise<boolean> {
  try {
    const res = await fetch("/api/streak/restore", { method: "POST", credentials: "same-origin" });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok: boolean; state: StreakState };
    publishStreak(body.state);
    return body.ok;
  } catch {
    return false;
  }
}

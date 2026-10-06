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

/**
 * The local day on which this device last got a CONFIRMED "activity recorded"
 * back from the server. See `recordStreakActivity`.
 */
const RECORDED_KEY = "frenz:streak-recorded";

/** The local calendar day, in the one format this file already uses. */
function localDay(): string {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * 🔴 FAILS OPEN, ALWAYS. Every uncertain answer is `false`, which means "send
 * the POST" — i.e. exactly today's behaviour. Nothing here can lose a streak;
 * the worst it can do is fail to save a request.
 */
function alreadyRecordedToday(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(RECORDED_KEY) === localDay();
  } catch {
    return false; // private mode — just send it
  }
}

function clearRecordedToday(): void {
  try {
    window.localStorage.removeItem(RECORDED_KEY);
  } catch {
    /* private mode — nothing was stored */
  }
}

/** Only ever called after the server CONFIRMED the day (a parsed 2xx state). */
function markRecordedToday(): void {
  try {
    window.localStorage.setItem(RECORDED_KEY, localDay());
  } catch {
    /* private mode — we simply re-record on the next page open, as before */
  }
}

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

export async function loadStreak(): Promise<StreakState> {
  const res = await fetch("/api/streak", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`streak ${res.status}`);
  const state = (await res.json()) as StreakState;
  writeDisplayCache(state);
  /*
    🔴 THE ONCE-A-DAY MARKER IS PER BROWSER; THE STREAK IS PER IDENTITY
    (owner, 2026-10-06: "streak icon is not showing in the browser landing
    page" — and it showed in a different browser).

    The marker said "recorded today" for whoever recorded first on this
    browser. After a sign-in, a sign-out, or cleared cookies, the identity is a
    different one that has NOT been recorded — but the marker still skipped the
    POST, so the server honestly answered 0 and the chip hid all day.

    This GET already runs on every page open, so asking costs nothing: if the
    server says today is not on THIS identity's record while the marker says
    it is, the marker is wrong. Drop it and record.
  */
  if (state.lastActivityDate !== state.today && alreadyRecordedToday()) {
    clearRecordedToday();
    void recordStreakActivity();
  }
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
 *
 * ── 🔴 ONCE A DAY PER DEVICE, NOT ONCE PER PAGE OPEN (2026-10-04) ───────────
 *
 * `streak-tracker.tsx` mounts on every page, so this fired on EVERY page open
 * — one Vercel function invocation per pageview, all day, to re-assert a fact
 * that changes once per day. The file already called the StrictMode duplicate
 * "a wasted request on every single page open"; the same sentence was true of
 * the 2nd, 10th and 40th navigation of the day, which nothing was counting.
 * Measured on a production build 2026-10-04: a POST on every one of 40
 * authenticated AI Studio page loads.
 *
 * The guard is deliberately lopsided. It skips ONLY when this device has a
 * confirmed, parsed 2xx for today's local date; every other outcome — no
 * marker, unreadable storage, a changed timezone, a failed or non-ok request —
 * sends the POST exactly as before. So the worst case is the behaviour we
 * already had, and a streak cannot be lost by it. The SERVER remains the only
 * authority on what day it is and what the day is worth (§18, engine.ts); this
 * only decides whether to bother asking twice.
 */
export async function recordStreakActivity(): Promise<StreakState | null> {
  // Not an error and not a failure — today is already on the record, so there
  // is nothing to celebrate that was not celebrated when it was recorded.
  if (alreadyRecordedToday()) return null;
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
    // Only now — a parsed 2xx. Marking any earlier (on send, or on a non-ok
    // response) would let a failed record suppress tomorrow's real one.
    markRecordedToday();
    publishStreak(state);
    return state;
  } catch {
    return null;
  }
}

/*
  ═══════════════════════════════════════════════════════════════════════════
   ONE SOUND PER STREAK VALUE, WHOEVER GETS THERE FIRST
  ═══════════════════════════════════════════════════════════════════════════

  Owner, 2026-08-25: "the streak animation doesnt animate when it increase, it
  should bounce and move and feel alive like celebration, with sound."

  Two surfaces can now legitimately want to make a noise for the SAME increment:
  the hero chip (every increase, wherever the visitor happens to be) and the
  once-a-day full-screen `StreakCelebration`. On the day both fire they fire
  within a few hundred ms of each other, and two overlapping copies of the same
  cue does not read as twice as celebratory — it reads as a bug.

  Gating the chip on `shouldCelebrate` would be the obvious fix and is racy:
  `markStreakCelebrated()` republishes the state with that flag already flipped,
  so which surface sees `true` depends on request timing.

  A claim is not racy. Whoever asks first for a given streak value gets the
  sound; everyone else that day is silently refused. Module-level, because both
  callers live in the same document and neither owns the other.

  🔴 Keyed by the VALUE, not a boolean: tomorrow's increment is a different
  number and must be able to claim its own sound.
*/
let soundedFor: number | null = null;

export function claimStreakSound(streak: number): boolean {
  if (soundedFor === streak) return false;
  soundedFor = streak;
  return true;
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

/**
 * In-Page Push daily frequency cap — pure logic, no DOM/React.
 *
 * ── How the cap works ─────────────────────────────────────────────────────────
 *
 * Rather than a `setTimeout` that resets a counter at midnight (fragile: a
 * backgrounded/throttled tab can miss the timer, and it does nothing for a tab
 * that was closed and reopened), the reset is encoded in the STORAGE KEY itself:
 * every read/write is scoped to `localDateKey()` — today's date in the visitor's
 * OWN timezone (`YYYY-MM-DD` from `Date#getFullYear/Month/Date`, never
 * `toISOString()`, which is UTC and would roll over at the wrong local hour).
 * The moment the calendar day changes, `localDateKey()` returns a different
 * string, so yesterday's count is simply never read again — the counter looks
 * "reset" with zero timer/interval bookkeeping and zero risk of a missed
 * boundary. The hook (`use-monetag-inpage-push.ts`) additionally schedules a
 * timer for the *current* session so `remaining` visibly updates without
 * needing an interaction, but that's a UX nicety layered on top of this
 * always-correct-on-read mechanism, not what makes the cap correct.
 *
 * ── Persistence + graceful degradation ────────────────────────────────────────
 *
 * Backed by `localStorage` so the count survives refreshes and browser
 * restarts, per the spec. Every access goes through `safeGet`/`safeSet`, which
 * swallow any thrown error (SSR with no `window`, privacy mode with storage
 * disabled, a full storage quota, a blocked-cookies-style policy that also
 * blocks storage) and fall back to a plain in-memory object scoped to this
 * module. That fallback still caps correctly for the lifetime of the current
 * page/session — it just can't survive a full browser restart, which is an
 * honest degradation, not a crash.
 */

const STORAGE_KEY = "frenz_monetag_inpage_push_v1";

/** Default daily cap. Override per-call if a future surface needs a different limit. */
export const DEFAULT_IN_PAGE_PUSH_DAILY_LIMIT = 5;

interface StoredState {
  date: string;
  count: number;
  /** Epoch ms of the last skip. Absent on records written before the cooldown existed. */
  skippedAt?: number;
}

/** In-memory fallback, used only when localStorage itself is unavailable/throws. */
let memoryState: StoredState | null = null;

function safeGet(): StoredState | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return memoryState;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    if (typeof parsed?.date !== "string" || typeof parsed?.count !== "number") return null;
    return {
      date: parsed.date,
      count: parsed.count,
      // Absent on records written before the skip cooldown shipped — an old
      // record must still read as a valid count, never as corrupt.
      ...(typeof parsed.skippedAt === "number" ? { skippedAt: parsed.skippedAt } : {}),
    };
  } catch {
    return memoryState;
  }
}

function safeSet(state: StoredState): void {
  memoryState = state; // always keep the in-memory copy current, even when storage also works
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage unavailable (quota, private mode, SSR) — memoryState already holds it */
  }
}

/** Today's date in the VISITOR'S local timezone, as `YYYY-MM-DD`. Never UTC. */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface InPagePushCapState {
  /** Impressions already recorded today (local time). */
  count: number;
  /** The configured daily limit this state was evaluated against. */
  limit: number;
  /** True once `count >= limit` — the script must not load again today. */
  limitReached: boolean;
  /** `max(0, limit - count)`, for an optional "N more today" UI. */
  remaining: number;
}

function toState(count: number, limit: number): InPagePushCapState {
  const clamped = Math.max(0, count);
  return { count: clamped, limit, limitReached: clamped >= limit, remaining: Math.max(0, limit - clamped) };
}

/**
 * Read today's count without mutating anything. A stored date that isn't today
 * (yesterday, or garbage) reads as 0 — see the module doc for why that's the
 * whole reset mechanism.
 */
export function readInPagePushCap(limit: number = DEFAULT_IN_PAGE_PUSH_DAILY_LIMIT): InPagePushCapState {
  const stored = safeGet();
  const today = localDateKey();
  const count = stored && stored.date === today ? stored.count : 0;
  return toState(count, limit);
}

/**
 * Record one In-Page Push script load as an impression for today, persist it,
 * and return the new state. Call this ONCE per successful script injection —
 * never speculatively — since it's the only honest proxy this module has for
 * "an ad slot was shown" (Monetag's self-placing widget renders itself after
 * its script loads; there is no publisher-side hook into its own render).
 */
export function recordInPagePushImpression(limit: number = DEFAULT_IN_PAGE_PUSH_DAILY_LIMIT): InPagePushCapState {
  const today = localDateKey();
  const stored = safeGet();
  const current = stored && stored.date === today ? stored.count : 0;
  const next = current + 1;
  // Carry the skip timestamp through: an impression recorded on a NEW day must
  // not reset a cooldown that is still running across the midnight boundary.
  safeSet({ date: today, count: next, ...(typeof stored?.skippedAt === "number" ? { skippedAt: stored.skippedAt } : {}) });
  return toState(next, limit);
}

/* ─────────────────────── skip cooldown (owner, 2026-09-03) ───────────────────
 *
 * "make the monetag in page push have a cooldown of 60 secs when is skipped"
 *
 * ── What this gates, and what it must never touch ─────────────────────────────
 *
 * 🔴 The owner's guardrail, same day: "it must not block monetag data from
 * reading accurately and showing impression, clicks and revenue."
 *
 * So the cooldown gates exactly ONE thing: whether WE inject a fresh copy of the
 * In-Page Push tag. It never removes, hides, wraps, sandboxes or intercepts
 * anything Monetag renders, and never touches a request Monetag makes. A widget
 * that is already on screen keeps running and keeps reporting; its impression,
 * its click and the revenue behind them are counted by Monetag exactly as they
 * are today. Suppressing a creative that has already been served would corrupt
 * the very numbers this must protect — an impression billed but never seen, or a
 * skip counted as a click — which is why the cooldown lives on the injection
 * side and nowhere else.
 *
 * ── Why the timestamp is NOT date-keyed like the counter above ────────────────
 *
 * `count` resets by calendar day, so it is read only when the stored date is
 * today. `skippedAt` deliberately is not: it is an absolute epoch ms, and a skip
 * at 23:59:30 must still hold its 60 seconds after local midnight. Gating it on
 * the date would silently cut that cooldown short at the day boundary.
 *
 * ── It fails OPEN ─────────────────────────────────────────────────────────────
 *
 * A `skippedAt` in the FUTURE (the visitor's clock moved backwards, a timezone
 * change, a tampered value) reads as "not in cooldown" rather than as a very long
 * one. The daily cap above fails closed because over-showing is the harm there;
 * here the harm runs the other way — a stuck cooldown would silently stop serving
 * the tag at all, which costs the owner revenue for as long as the clock is wrong.
 */

/** The owner's number: a skipped In-Page Push holds off the next tag load this long. */
export const IN_PAGE_PUSH_SKIP_COOLDOWN_MS = 60_000;

export interface InPagePushSkipState {
  /** When the last skip was recorded, epoch ms, or null if there has never been one. */
  skippedAt: number | null;
  /** The window this state was evaluated against. */
  cooldownMs: number;
  /** Milliseconds still to wait, 0 once the window has passed. */
  remainingMs: number;
  /** True while the tag must not be injected again. */
  inCooldown: boolean;
}

function toSkipState(skippedAt: number | null, now: number, cooldownMs: number): InPagePushSkipState {
  if (skippedAt === null) return { skippedAt: null, cooldownMs, remainingMs: 0, inCooldown: false };
  const elapsed = now - skippedAt;
  // Negative elapsed = the clock went backwards. Fail open (see the note above).
  const remainingMs = elapsed < 0 ? 0 : Math.max(0, cooldownMs - elapsed);
  return { skippedAt, cooldownMs, remainingMs, inCooldown: remainingMs > 0 };
}

/** Read the skip cooldown without mutating anything. */
export function readInPagePushSkip(
  now: number = Date.now(),
  cooldownMs: number = IN_PAGE_PUSH_SKIP_COOLDOWN_MS,
): InPagePushSkipState {
  const stored = safeGet();
  const skippedAt = typeof stored?.skippedAt === "number" ? stored.skippedAt : null;
  return toSkipState(skippedAt, now, cooldownMs);
}

/**
 * Record that the visitor skipped an In-Page Push, starting the cooldown.
 *
 * Preserves today's impression count rather than rewriting the record from
 * scratch — a skip must not hand the visitor a fresh daily allowance.
 */
export function recordInPagePushSkip(
  now: number = Date.now(),
  cooldownMs: number = IN_PAGE_PUSH_SKIP_COOLDOWN_MS,
): InPagePushSkipState {
  const today = localDateKey(new Date(now));
  const stored = safeGet();
  const count = stored && stored.date === today ? stored.count : 0;
  safeSet({ date: today, count, skippedAt: now });
  return toSkipState(now, now, cooldownMs);
}

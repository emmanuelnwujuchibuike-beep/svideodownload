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
    return { date: parsed.date, count: parsed.count };
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
  safeSet({ date: today, count: next });
  return toState(next, limit);
}

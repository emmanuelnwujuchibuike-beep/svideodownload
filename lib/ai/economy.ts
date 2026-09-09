/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — THE USAGE ECONOMY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, as a PERMANENT architectural rule: "Free daily + free
 * weekly allowance → prepaid AI balance… This architecture is the permanent
 * standard for every future AI feature and must not be bypassed by creating
 * separate AI access, pricing, credit, or subscription logic."
 *
 * Pure. No database, no network, no clock of its own — `now` is always passed
 * in. That is what lets the rules below be tested exhaustively, including the
 * ones about money, without a Postgres instance or a payment provider.
 *
 * ── 🔴 EVERY AMOUNT IS AN INTEGER NUMBER OF CENTS ───────────────────────────
 *
 * Never a float, never dollars, anywhere in this system — the database, the
 * API, this module, the button. `0.1 + 0.2 !== 0.3` in binary floating point,
 * and a balance that drifts by fractions of a cent per transaction is a ledger
 * that stops reconciling, which is the one thing a ledger exists to do.
 *
 * Dollars appear exactly once, in `formatCents`, on the way to a screen.
 *
 * ── 🔴 PRO AND BUSINESS BUY NO AI. THIS IS THE RULE MOST LIKELY TO BE BROKEN ─
 *
 * "Pro users do NOT get unlimited AI. Business users do NOT get unlimited AI…
 * Do not accidentally create logic such as `if subscription === pro =>
 * unlimited AI`. That behavior is explicitly prohibited."
 *
 * So this module does not take a plan, an audience or a subscription at all.
 * It cannot express "unlimited for Pro" because it is never told who is Pro —
 * which is a stronger guarantee than remembering not to write it, and it is
 * why the free allowance is passed in as two plain numbers rather than looked
 * up from a policy table keyed by plan.
 */

/** What a job may be charged against. */
export type AiFundingSource =
  /** Inside the daily and weekly free allowance. Costs nothing. */
  | "free"
  /** Free allowance spent; the member's prepaid balance covers it. */
  | "balance";

export type AiFundingDecision =
  | { ok: true; source: AiFundingSource; priceCents: number }
  | {
      ok: false;
      /** Why they cannot run this job — the interface picks the sentence. */
      reason: "daily_and_weekly_spent_no_balance";
      priceCents: number;
      balanceCents: number;
      shortfallCents: number;
    };

export interface AiAllowanceState {
  /** Free jobs used since the daily boundary. */
  usedToday: number;
  /** Free jobs used since the weekly boundary. */
  usedThisWeek: number;
  dailyLimit: number;
  weeklyLimit: number;
  /** Prepaid balance, in cents. */
  balanceCents: number;
}

/**
 * How many FREE jobs remain right now.
 *
 * ── 🔴 THE LOWER OF THE TWO, WHICH IS THE WHOLE POINT ───────────────────────
 *
 * "A user cannot bypass the weekly limit by waiting for the daily counter to
 * reset." The owner's own worked example: with 2/day and 5/week, a member who
 * uses 2 on Monday, 2 on Tuesday and 1 on Wednesday has spent the week — and
 * Thursday's daily reset must not hand them a sixth.
 *
 * Taking the MINIMUM of the two remainders is what makes that true, and it is
 * one line precisely so nobody has to reason about the interaction twice.
 * Clamped at zero: a limit lowered by an operator below what somebody has
 * already used must read as "none left", never as a negative that a later
 * comparison could treat as remaining.
 */
export function freeRemaining(state: AiAllowanceState): number {
  const daily = Math.max(0, state.dailyLimit - state.usedToday);
  const weekly = Math.max(0, state.weeklyLimit - state.usedThisWeek);
  return Math.min(daily, weekly);
}

/**
 * Decide how one job gets paid for.
 *
 * ── 🔴 FREE FIRST, ALWAYS ───────────────────────────────────────────────────
 *
 * A member with both allowance and balance spends the allowance. The reverse
 * would charge somebody who had a free job available, which is the kind of
 * error that is invisible in aggregate and unforgivable individually.
 *
 * ⚠️ This DECIDES. It does not reserve, deduct or record anything — the atomic
 * reservation is a database function, because a decision made here and applied
 * later is a race two concurrent requests can win together (§12). Treat the
 * result as advice for the interface and as the intent handed to that function.
 */
export function decideFunding(state: AiAllowanceState, priceCents: number): AiFundingDecision {
  if (freeRemaining(state) > 0) return { ok: true, source: "free", priceCents: 0 };

  if (state.balanceCents >= priceCents) {
    return { ok: true, source: "balance", priceCents };
  }

  return {
    ok: false,
    reason: "daily_and_weekly_spent_no_balance",
    priceCents,
    balanceCents: state.balanceCents,
    shortfallCents: Math.max(0, priceCents - state.balanceCents),
  };
}

/* ────────────────────────── the two reset boundaries ─────────────────────── */

/**
 * Midnight UTC today.
 *
 * 🔴 UTC, and it must stay UTC. The daily allowance has reset at midnight UTC
 * since Part 2 (`ai_usage_daily.usage_date` is a DATE written by the database),
 * and every sentence the product has ever shown a member says so. Changing this
 * to a local boundary would silently give some timezones an extra day's worth
 * of allowance on the day of the change.
 */
export function dayStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The start of the current week — MONDAY, 00:00 UTC.
 *
 * ── 🔴 A FIXED CALENDAR WEEK, NOT A ROLLING 7 DAYS ──────────────────────────
 *
 * The spec says: "Define the weekly reset consistently and document it in the
 * implementation." This is that definition, and the choice matters.
 *
 * A ROLLING window ("the last 7 days") sounds fairer and is worse in every way
 * that counts here. It never resets, so a member who has spent their five can
 * never be told when they get more — only "some time in the next week" — and
 * the answer changes every hour. It also cannot be counted from
 * `ai_usage_daily` with a simple date range, because the oldest day expires
 * partway through.
 *
 * A fixed week has one boundary everybody shares, it is countable with a `>=`
 * on a DATE column, and it produces a sentence a person can act on: "your free
 * videos come back on Monday."
 *
 * Monday rather than Sunday because ISO-8601 says so and because the rest of
 * this codebase's date handling is ISO. UTC for the same reason the day is.
 */
export function weekStartUtc(now: Date): Date {
  const day = dayStartUtc(now);
  // getUTCDay: 0 = Sunday … 6 = Saturday. Monday is 1, so Sunday is 6 days in.
  const weekday = day.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(day.getTime() - daysSinceMonday * 86_400_000);
}

/** When the weekly allowance next resets — the following Monday, 00:00 UTC. */
export function weekResetsAt(now: Date): Date {
  return new Date(weekStartUtc(now).getTime() + 7 * 86_400_000);
}

/**
 * `YYYY-MM-DD`, for comparing against a Postgres DATE column.
 *
 * 🔴 Built from the UTC parts rather than `toISOString().slice(0, 10)` —
 * which happens to agree here only because the input is already a UTC
 * midnight. Being explicit means a caller who passes a non-midnight date still
 * gets the right day rather than an off-by-one at the timezone edge.
 */
export function isoDate(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

/* ──────────────────────────────── money ──────────────────────────────────── */

/**
 * Cents as a person reads them.
 *
 * The ONLY place in this system where an amount becomes a decimal, and it
 * happens on the way to a screen — never back into a calculation.
 */
export function formatCents(cents: number, currency = "$"): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  return `${sign}${currency}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * A top-up amount the server is willing to accept, in cents.
 *
 * ── 🔴 THE CLIENT NEVER CHOOSES A FREE-FORM AMOUNT ─────────────────────────
 *
 * "Users must not be able to manipulate… request payloads… to bypass AI
 * limits", and an amount field is the most obvious thing to manipulate. A
 * fixed set means a tampered request matches nothing and is refused, rather
 * than being clamped into something plausible.
 *
 * The values are round dollar amounts because that is what a person expects to
 * top up, and the smallest is ten videos' worth at the shipped price — below
 * that the payment processor's own fee is a meaningful fraction of the sale.
 */
export const AI_TOPUP_OPTIONS_CENTS: readonly number[] = [500, 1_000, 2_500, 5_000] as const;

export function isValidTopupCents(value: unknown): value is number {
  return typeof value === "number" && AI_TOPUP_OPTIONS_CENTS.includes(value);
}

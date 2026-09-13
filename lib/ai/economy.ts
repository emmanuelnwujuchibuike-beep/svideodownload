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
/**
 * The amounts offered, derived from the operator's minimum.
 *
 * ── 🔴 GENERATED FROM ONE SETTING, NOT FOUR ─────────────────────────────────
 *
 * Owner, 2026-09-09: "whats the minimum deposit? it should be configurable from
 * admin dashboard."
 *
 * Four separate admin fields would let an operator produce an incoherent ladder
 * — 5, 3, 40, 12 — and would need four validations. One minimum with a fixed
 * multiplier ladder is always ordered, always starts where the operator said,
 * and is one number to reason about.
 *
 * ── 🔴 IT IS STILL A CLOSED SET, WHICH IS THE SECURITY PROPERTY ─────────────
 *
 * The point of offering amounts rather than accepting one is that a tampered
 * request matches NOTHING and is refused. Generating the set changes where the
 * numbers come from; it does not weaken that, because the server regenerates
 * the same ladder from the same setting when it validates. A client that sends
 * an amount between two rungs is refused exactly as before.
 *
 * The multipliers are 1/2/5/10 — the ordinary shape of a top-up ladder, and
 * wide enough that somebody who cleans a lot is not buying credit weekly.
 */
export const AI_TOPUP_MULTIPLIERS: readonly number[] = [1, 2, 5, 10] as const;

export function aiTopupOptions(minCents: number): number[] {
  /*
    A malformed minimum yields the shipped default rather than an empty ladder:
    a top-up screen with no amounts on it is a member who cannot pay us, which
    is a worse failure than an amount an operator did not choose.
  */
  const base =
    Number.isFinite(minCents) && minCents > 0 ? Math.round(minCents) : AI_MIN_TOPUP_FALLBACK_CENTS;
  return AI_TOPUP_MULTIPLIERS.map((m) => base * m);
}

/** Used only when the configured minimum is missing or nonsense. */
export const AI_MIN_TOPUP_FALLBACK_CENTS = 500;

/**
 * Is this an amount we actually offered?
 *
 * 🔴 The minimum is passed in rather than read here, because this module is
 * pure and the setting is an async database read. The CALLER must pass the
 * server's own value — never one that arrived in the request, which would let
 * somebody supply a minimum of 1 alongside an amount of 1 and buy nothing for
 * nothing.
 */
export function isValidTopupCents(value: unknown, minCents: number): value is number {
  return typeof value === "number" && aiTopupOptions(minCents).includes(value);
}

/* ─────────────────────── a custom amount, still bounded ──────────────────── */

/**
 * The floor a top-up must clear — the operator's minimum, or the fallback when
 * that setting is missing or nonsense.
 *
 * Extracted because three separate checks below have to agree on it exactly,
 * and a ladder that starts at one number while the validator accepts another is
 * a button that fails when pressed.
 */
export function aiTopupFloor(minCents: number): number {
  return Number.isFinite(minCents) && minCents > 0 ? Math.round(minCents) : AI_MIN_TOPUP_FALLBACK_CENTS;
}

/**
 * The most one payment may add, as a multiple of the minimum.
 *
 * ── 🔴 EXPRESSED IN MINIMUMS, NEVER IN A FIXED AMOUNT ───────────────────────
 *
 * A hardcoded ceiling is the exact bug that refused the owner's ₦500 price: a
 * number reasoned about in dollars is meaningless in a currency worth ~1/1500th
 * as much. Deriving it from the operator's own minimum makes it scale with
 * whatever currency they configured, without this module ever being told which
 * one that is.
 *
 * 100× is generous — a hundred minimum deposits in one go — while still being a
 * bound. Its job is not to stop a large customer; it is to make a mistyped
 * amount (an extra three zeros) fail at our door rather than at their bank's.
 */
export const AI_TOPUP_MAX_MULTIPLIER = 100;

export function aiTopupCeiling(minCents: number): number {
  return aiTopupFloor(minCents) * AI_TOPUP_MAX_MULTIPLIER;
}

/**
 * An amount the server is willing to charge — any of them, not just a rung.
 *
 * ── 🔴 WHY THE CLOSED SET STOPPED BEING THE RIGHT ANSWER ────────────────────
 *
 * Owner, 2026-09-09: "the add balance dont have an input field to add a custom
 * amount."
 *
 * The old `isValidTopupCents` accepted only the four generated rungs, and the
 * comment beside it said that closed set WAS the security property. It was
 * overstating its own case. The thing actually being defended against is
 * somebody topping up for a cent — buying credit below the price of processing
 * it — and a server-side FLOOR closes that completely. Membership of a ladder
 * closes nothing extra: every rung is above the floor, so the ladder was only
 * ever a floor with three arbitrary gaps in it.
 *
 * What still matters, and is preserved exactly:
 *
 *   · the floor and the ceiling come from the SERVER'S settings, never from
 *     the request — see the call site, which reads them after the settings
 *     fetch precisely so a body-supplied minimum cannot travel with the amount;
 *   · the value must be an INTEGER number of minor units. `19.999` cents is not
 *     an amount, and a float here would reach the ledger as one;
 *   · this route still grants nothing. The amount decides what Paystack is
 *     asked to collect; the credit happens against what Paystack says SETTLED.
 */
export function isAcceptableTopupCents(value: unknown, minCents: number): value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  return value >= aiTopupFloor(minCents) && value <= aiTopupCeiling(minCents);
}

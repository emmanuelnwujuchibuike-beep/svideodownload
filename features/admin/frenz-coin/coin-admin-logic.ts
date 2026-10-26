/**
 * Frenz Coin Part 6 — the admin console's pure decisions: turning the form into a settings PATCH, which withdrawal
 * actions a status allows, how a deposit reversal reads, and whether a correction may be sent. Nothing here grants
 * anything: /api/admin/landing normalises and audits every setting, and each money route re-checks its own rules in
 * the database. These only stop an operator sending something the server would refuse.
 */
import type { CoinAdminAlerts, FrenzCoinConfig } from "@/lib/coin/config";

// ── money in the form: dollars typed, integer cents sent ─────────────────────

/** "12", "12.5", "1,250.00" → cents; "" or junk → null. 0 is allowed (a fee may be zero). String arithmetic only. */
export function dollarsToCents(raw: string): number | null {
  const s = raw.replace(/[,\s$]/g, "");
  const m = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}
export const centsToDollars = (c: number) => (c / 100).toFixed(2);

/** "10" → 1000 basis points; up to two decimals ("6.25" → 625). */
export function percentToBp(raw: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(raw.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}
export const bpToPercent = (bp: number) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2));

/** A whole number field ("" or junk → null). */
export function wholeNumber(raw: string): number | null {
  return /^\d{1,12}$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

// ── the settings form ───────────────────────────────────────────────────────

/** The form, as strings the operator edits. Built from the server's config; turned back into a patch on save. */
export interface CoinSettingsForm {
  enabled: boolean;
  adminAlerts: CoinAdminAlerts;
  deposits: { enabled: boolean; holdHours: string; min: string; max: string };
  transfers: { enabled: boolean; percent: string; low: string; high: string; flatBelow: string; flatMid: string; flatAbove: string; min: string; max: string; dailyMax: string };
  withdrawals: { enabled: boolean; percent: string; flat: string; min: string; max: string; maxPerDay: string; maxMonth: string; requireQualification: boolean; requireEmailConfirmed: boolean; rateSource: "none" | "fixed" | "market"; nairaPerUsd: string };
  pin: { maxAttempts: string; lockMinutes: string; resetTtlMinutes: string; resetMaxPerHour: string; resetCodeMaxAttempts: string };
}

export function formFromConfig(c: FrenzCoinConfig): CoinSettingsForm {
  const t = c.transfers;
  const w = c.withdrawals;
  return {
    enabled: c.enabled,
    adminAlerts: c.adminAlerts,
    deposits: { enabled: c.deposits.enabled, holdHours: String(c.deposits.holdHours), min: centsToDollars(c.deposits.minCents), max: centsToDollars(c.deposits.maxCents) },
    transfers: { enabled: t.enabled, percent: bpToPercent(t.percentBp), low: centsToDollars(t.lowThresholdCents), high: centsToDollars(t.highThresholdCents), flatBelow: centsToDollars(t.flatBelowCents), flatMid: centsToDollars(t.flatMidCents), flatAbove: centsToDollars(t.flatAboveCents), min: centsToDollars(t.minCents), max: centsToDollars(t.maxCents), dailyMax: centsToDollars(t.dailyMaxCents) },
    withdrawals: {
      enabled: w.enabled,
      percent: bpToPercent(w.percentBp),
      flat: centsToDollars(w.flatCents),
      min: centsToDollars(w.minCents),
      max: centsToDollars(w.maxCents),
      maxPerDay: String(w.maxPerDay),
      maxMonth: centsToDollars(w.maxMonthCents),
      requireQualification: w.requireQualification,
      requireEmailConfirmed: w.requireEmailConfirmed,
      rateSource: w.payoutRateSource,
      // kobo per USD → naira per USD, as typed; empty when no fixed rate was ever approved (never a made-up default)
      nairaPerUsd: w.payoutMinorPerUsd ? centsToDollars(w.payoutMinorPerUsd) : "",
    },
    pin: { maxAttempts: String(c.pin.maxAttempts), lockMinutes: String(c.pin.lockMinutes), resetTtlMinutes: String(c.pin.resetTtlMinutes), resetMaxPerHour: String(c.pin.resetMaxPerHour), resetCodeMaxAttempts: String(c.pin.resetCodeMaxAttempts) },
  };
}

type Problem = { field: string; message: string };
type Patch = Record<string, unknown>;

/**
 * The form → the frenzCoin PATCH the audited settings API takes, or the problems to fix first. Only what changed is
 * sent (the server merges, normalises, bumps the version and writes the audit row). The bounds are the server's own
 * (lib/coin/config.ts COIN_BOUNDS, the admin route's schema) — repeated here only to point at the field.
 */
export function buildCoinPatch(form: CoinSettingsForm, current: FrenzCoinConfig): { ok: true; patch: Patch; changes: string[] } | { ok: false; problems: Problem[] } {
  const problems: Problem[] = [];
  const money = (field: string, raw: string, min: number, max = 100_000_000) => {
    const v = dollarsToCents(raw);
    if (v === null || v < min || v > max) problems.push({ field, message: `Enter an amount from $${centsToDollars(min)} to $${centsToDollars(max)}.` });
    return v ?? 0;
  };
  const pct = (field: string, raw: string) => {
    const v = percentToBp(raw);
    if (v === null || v > 5_000) problems.push({ field, message: "Enter a percentage from 0 to 50." });
    return v ?? 0;
  };
  const whole = (field: string, raw: string, min: number, max: number) => {
    const v = wholeNumber(raw);
    if (v === null || v < min || v > max) problems.push({ field, message: `Enter a whole number from ${min} to ${max}.` });
    return v ?? min;
  };
  const d = form.deposits;
  const t = form.transfers;
  const w = form.withdrawals;
  const next = {
    enabled: form.enabled,
    adminAlerts: form.adminAlerts,
    deposits: { enabled: d.enabled, holdHours: whole("deposits.holdHours", d.holdHours, 0, 2_160), minCents: money("deposits.min", d.min, 1), maxCents: money("deposits.max", d.max, 1) },
    transfers: {
      enabled: t.enabled,
      percentBp: pct("transfers.percent", t.percent),
      lowThresholdCents: money("transfers.low", t.low, 1),
      highThresholdCents: money("transfers.high", t.high, 1),
      flatBelowCents: money("transfers.flatBelow", t.flatBelow, 0, 100_000),
      flatMidCents: money("transfers.flatMid", t.flatMid, 0, 100_000),
      flatAboveCents: money("transfers.flatAbove", t.flatAbove, 0, 100_000),
      minCents: money("transfers.min", t.min, 1),
      maxCents: money("transfers.max", t.max, 1),
      dailyMaxCents: money("transfers.dailyMax", t.dailyMax, 1),
    },
    withdrawals: {
      enabled: w.enabled,
      percentBp: pct("withdrawals.percent", w.percent),
      flatCents: money("withdrawals.flat", w.flat, 0, 100_000),
      minCents: money("withdrawals.min", w.min, 1),
      maxCents: money("withdrawals.max", w.max, 1),
      maxPerDay: whole("withdrawals.maxPerDay", w.maxPerDay, 1, 100),
      maxMonthCents: money("withdrawals.maxMonth", w.maxMonth, 1),
      requireQualification: w.requireQualification,
      requireEmailConfirmed: w.requireEmailConfirmed,
      payoutRateSource: w.rateSource,
      payoutMinorPerUsd: w.rateSource === "fixed" ? dollarsToCents(w.nairaPerUsd) : current.withdrawals.payoutMinorPerUsd,
    },
    pin: {
      maxAttempts: whole("pin.maxAttempts", form.pin.maxAttempts, 3, 10),
      lockMinutes: whole("pin.lockMinutes", form.pin.lockMinutes, 5, 1_440),
      resetTtlMinutes: whole("pin.resetTtlMinutes", form.pin.resetTtlMinutes, 5, 30),
      resetMaxPerHour: whole("pin.resetMaxPerHour", form.pin.resetMaxPerHour, 1, 10),
      resetCodeMaxAttempts: whole("pin.resetCodeMaxAttempts", form.pin.resetCodeMaxAttempts, 3, 10),
    },
  };
  // cross-field rules the server would otherwise quietly clamp
  if (next.deposits.maxCents < next.deposits.minCents) problems.push({ field: "deposits.max", message: "The largest deposit can't be below the smallest." });
  if (next.transfers.maxCents < next.transfers.minCents) problems.push({ field: "transfers.max", message: "The largest transfer can't be below the smallest." });
  if (next.transfers.highThresholdCents < next.transfers.lowThresholdCents) problems.push({ field: "transfers.high", message: "The upper bracket must start at or above the lower one." });
  if (next.withdrawals.maxCents < next.withdrawals.minCents) problems.push({ field: "withdrawals.max", message: "The largest withdrawal can't be below the smallest." });
  if (w.rateSource === "fixed") {
    const r = dollarsToCents(w.nairaPerUsd);
    if (r === null || r <= 0 || r > 999_999_999) problems.push({ field: "withdrawals.nairaPerUsd", message: "A fixed payout needs the approved naira rate per US dollar." });
  }
  if (problems.length) return { ok: false, problems };

  // only what changed
  const patch: Patch = {};
  const changes: string[] = [];
  const cur = current as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(next)) {
    if (v !== null && typeof v === "object") {
      const was = (cur[k] ?? {}) as Record<string, unknown>;
      const diff: Patch = {};
      for (const [kk, vv] of Object.entries(v as Patch)) if (JSON.stringify(was[kk] ?? null) !== JSON.stringify(vv ?? null)) {
        diff[kk] = vv;
        changes.push(`${k}.${kk}`);
      }
      if (Object.keys(diff).length) patch[k] = diff;
    } else if (cur[k] !== v) {
      patch[k] = v;
      changes.push(k);
    }
  }
  return { ok: true, patch, changes };
}

/** Changes the operator must confirm explicitly before saving (they switch real money on or change who is paid what). */
export function riskyChanges(changes: string[], form: CoinSettingsForm): string[] {
  const out: string[] = [];
  if (changes.includes("enabled") && form.enabled) out.push("Frenz Coin will be switched ON for members.");
  if (changes.includes("enabled") && !form.enabled) out.push("Frenz Coin will be switched OFF for members.");
  if (changes.includes("withdrawals.payoutRateSource")) out.push(form.withdrawals.rateSource === "none" ? "Bank payouts will stop: no payout rate." : `Bank payouts will use the ${form.withdrawals.rateSource} rate.`);
  if (changes.includes("withdrawals.payoutMinorPerUsd")) out.push(`The fixed payout rate becomes ₦${form.withdrawals.nairaPerUsd} per $1.`);
  if (changes.some((c) => /percentBp|flat/.test(c))) out.push("Fees change for new transfers or withdrawals.");
  if (changes.includes("deposits.holdHours")) out.push(`New deposits will be held ${form.deposits.holdHours} hour(s).`);
  return out;
}

// ── withdrawals ─────────────────────────────────────────────────────────────

export type WithdrawalAction = "review" | "approve" | "pay" | "reject";

/**
 * What the admin may do with a coin withdrawal in this status, through the existing routes — the database still
 * allows only the legal moves (resolve_withdrawal). Paying needs an approved payout rate; without one it is not offered.
 */
export function withdrawalActions(status: string, payoutRateApproved: boolean): WithdrawalAction[] {
  switch (status) {
    case "pending":
      return ["review", "approve", "reject"];
    case "reviewing":
      return ["approve", "reject"];
    case "approved":
      return payoutRateApproved ? ["pay", "reject"] : ["reject"];
    default:
      return [];
  }
}

export const WITHDRAWAL_STATUS: Record<string, { label: string; tone: "amber" | "blue" | "green" | "rose" | "gray" }> = {
  pending: { label: "Requested", tone: "amber" },
  reviewing: { label: "In review", tone: "amber" },
  approved: { label: "Approved", tone: "blue" },
  processing: { label: "Paying", tone: "blue" },
  completed: { label: "Paid", tone: "green" },
  rejected: { label: "Rejected (returned)", tone: "rose" },
  cancelled: { label: "Cancelled (returned)", tone: "gray" },
  reversed: { label: "Returned by bank", tone: "rose" },
};

// ── deposit reversals ───────────────────────────────────────────────────────

export type ReversalRow = { id: string; kind: string; reference: string; userId: string; phase: string; state: string; depositCents: number; due: number; recovered: number; shortfall: number; shortfallCleared: boolean; createdAt: string };

/**
 * A reversal, in the operator's words, and what can be recorded next. The API's states: recovered, disputed, restored,
 * lost, review (a partial refund held for a person), applied. There is NO "rejected" state — a partial refund in review
 * can only be applied.
 */
export function reversalView(r: ReversalRow): { label: string; tone: "amber" | "blue" | "green" | "rose" | "gray"; actions: ("resolve" | "apply_partial" | "clear")[]; needsAction: boolean } {
  const base: Record<string, { label: string; tone: "amber" | "blue" | "green" | "rose" | "gray" }> = {
    recovered: { label: "Taken back", tone: "gray" },
    disputed: { label: "Chargeback — awaiting outcome", tone: "amber" },
    restored: { label: "Dispute won — restored", tone: "green" },
    lost: { label: "Dispute lost", tone: "rose" },
    review: { label: "Partial refund — pending review", tone: "amber" },
    applied: { label: "Partial refund — applied", tone: "blue" },
  };
  const v = base[r.state] ?? { label: r.state, tone: "gray" as const };
  const actions: ("resolve" | "apply_partial" | "clear")[] = [];
  if (r.state === "disputed") actions.push("resolve");
  if (r.state === "review") actions.push("apply_partial");
  const openShortfall = r.shortfall > 0 && !r.shortfallCleared;
  if (openShortfall) actions.push("clear");
  return { label: openShortfall ? `${v.label} · shortfall open` : r.shortfall > 0 ? `${v.label} · shortfall settled` : v.label, tone: openShortfall ? "rose" : v.tone, actions, needsAction: actions.length > 0 };
}

// ── transfer corrections ────────────────────────────────────────────────────

/** A reason worth auditing: at least 10 characters and three words (the API's own floor is 3 characters). */
export function meaningfulReason(raw: string): boolean {
  const s = raw.trim();
  return s.length >= 10 && s.split(/\s+/).filter(Boolean).length >= 3;
}

/** Can this correction be sent? The database re-checks every limit — this explains the refusal before the round trip. */
export function correctionProblem(t: { feeCents: number; feeRefundable: boolean; creditRemainingCents: number }, kind: "fee_refund" | "sender_credit", amountRaw: string, reason: string): string | null {
  if (!meaningfulReason(reason)) return "Write a reason of at least a few words — it is kept in the audit log.";
  if (kind === "fee_refund") return t.feeRefundable ? null : t.feeCents > 0 ? "This transfer's fee was already refunded." : "This transfer had no fee.";
  const c = dollarsToCents(amountRaw);
  if (c === null || c <= 0) return "Enter the amount to credit the sender.";
  if (c > t.creditRemainingCents) return `Credits can't add up to more than the transfer ($${centsToDollars(t.creditRemainingCents)} left).`;
  return null;
}

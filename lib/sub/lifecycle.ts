import { usd } from "@/lib/creator/membership/engine";

/**
 * The subscription lifecycle (Frenz Exclusive Part 5) — pure, so every state is tested without a
 * database, and the subscriber manager, the creator's list, checkout and the reminder sweep all
 * read a membership the same way.
 *
 * ── What "cancel" means ─────────────────────────────────────────────────────
 * There is no recurring charge: every period is one Paystack payment. Cancelling ("Leave" on a
 * paid subscription) records "I won't renew" (0250 cancelled_at + cancel_period) and changes
 * NOTHING about access: status stays 'active', period_end stays where the payment put it. The
 * intent belongs to one period: settlement moves period_index on with every paid renewal, so a
 * renewal makes an older cancellation stale by itself.
 *
 * ── What grants access ──────────────────────────────────────────────────────
 * Exactly what `hasActiveSub` checks: status 'active', billing 'sub', period_end in the future,
 * and no block between the two. The cancellation columns are never read for access, so clearing
 * one can't bring access back, and setting one can't take it early. A refund, a dispute, a
 * removal, a block or a suspension ends access the way it always did.
 */

/** Renewing early is offered (and checkout accepts it) only this close to the end. */
export const RENEW_WINDOW_DAYS = 3;
const DAY = 86_400_000;
/** Paystack can take this long to finish a transfer/USSD payment; the reconcile sweep asks about it until then. */
export const PENDING_PAYMENT_MS = 2 * DAY;

export interface MembershipFacts {
  status: string;
  billing: string;
  periodEnd: string | null;
  periodIndex: number;
  /** 0250: the period_index the "won't renew" belongs to (null = never cancelled, or before 0250) */
  cancelPeriod: number | null;
  joinedAt: string | null;
  endedAt?: string | null;
}

export type SubState =
  /** paid up, will need a manual renewal */
  | "active"
  /** paid up, and the subscriber said they won't renew */
  | "ending"
  /** a payment is being confirmed; NOT access */
  | "pending"
  /** the paid time ran out */
  | "expired"
  /** the last payment was refunded, disputed or reversed */
  | "refunded"
  /** left before 0250's rules (access ended on the tap) */
  | "ended"
  /** the creator removed this subscriber */
  | "removed"
  /** paid up on paper, but a block (either way) or the creator's account stops access */
  | "unavailable";

export function isCancelled(m: Pick<MembershipFacts, "cancelPeriod" | "periodIndex">): boolean {
  return m.cancelPeriod !== null && m.cancelPeriod === m.periodIndex;
}

/** Paid time still running — the membership row's half of `hasActiveSub`. */
export function paidThrough(m: Pick<MembershipFacts, "status" | "billing" | "periodEnd">, now: number): boolean {
  return m.status === "active" && m.billing === "sub" && !!m.periodEnd && Date.parse(m.periodEnd) > now;
}

const REVERSED = new Set(["refunded", "disputed", "reversed"]);

export function subState(
  m: MembershipFacts,
  ctx: { now: number; blocked: boolean; creatorAvailable: boolean; lastPurchaseStatus: string | null; pendingPayment: boolean },
): SubState {
  if (m.status === "removed") return "removed";
  if (paidThrough(m, ctx.now)) {
    if (ctx.blocked || !ctx.creatorAvailable) return "unavailable";
    return isCancelled(m) ? "ending" : "active";
  }
  // no access from here down — a payment in flight is shown as exactly that, never as access
  if (ctx.pendingPayment) return "pending";
  if (ctx.lastPurchaseStatus && REVERSED.has(ctx.lastPurchaseStatus)) return "refunded";
  if (m.status === "ended" && m.periodEnd && Date.parse(m.periodEnd) > ctx.now) return "ended";
  return "expired";
}

export function hasAccess(state: SubState): boolean {
  return state === "active" || state === "ending";
}

/** Within the last RENEW_WINDOW_DAYS of a paid period (renewing then adds a period from its end). */
export function inRenewWindow(periodEnd: string | null, now: number): boolean {
  if (!periodEnd) return false;
  const left = Date.parse(periodEnd) - now;
  return left > 0 && left <= RENEW_WINDOW_DAYS * DAY;
}

/**
 * Checkout's duplicate guard. A subscriber who is paid up past the renewal window would only
 * buy days they already have — refused. Inside the window a renewal extends from the current
 * end (settle_sub_purchase, as it always has); after expiry it starts now.
 */
export function checkoutBlockedByActive(m: Pick<MembershipFacts, "status" | "billing" | "periodEnd"> | null, now: number): boolean {
  if (!m || !paidThrough(m, now)) return false;
  return !inRenewWindow(m.periodEnd, now);
}

export interface SubActions {
  renew: boolean;
  cancel: boolean;
  resume: boolean;
}

export function subActions(state: SubState, m: Pick<MembershipFacts, "periodEnd">, ctx: { now: number; canPurchase: boolean }): SubActions {
  const renewable = ctx.canPurchase && (state === "expired" || state === "refunded" || state === "ended" || ((state === "active" || state === "ending") && inRenewWindow(m.periodEnd, ctx.now)));
  return { renew: renewable, cancel: state === "active", resume: state === "ending" };
}

export const STATE_LABEL: Record<SubState, string> = {
  active: "Active",
  ending: "Ending",
  pending: "Payment pending",
  expired: "Expired",
  refunded: "Refunded",
  ended: "Ended",
  removed: "Unavailable",
  unavailable: "Unavailable",
};

export function fmtDateTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The sentence under a membership in the manager. */
export function stateLine(state: SubState, periodEnd: string | null): string {
  const until = fmtDateTime(periodEnd);
  switch (state) {
    case "active":
      return until ? `Access until ${until}. It doesn't renew automatically.` : "Active.";
    case "ending":
      return until ? `You cancelled. Access continues until ${until}, then ends.` : "You cancelled.";
    case "pending":
      return "We're confirming a payment with Paystack. Access starts once it's confirmed.";
    case "expired":
      return until ? `Ended ${until}.` : "Ended.";
    case "refunded":
      return "The payment was refunded or reversed, so access ended.";
    case "ended":
      return "You left this subscription.";
    case "removed":
      return "This subscription can't be renewed.";
    case "unavailable":
      return "This creator's exclusive posts aren't available to you right now.";
  }
}

// ─── Transactions and receipts ───────────────────────────────────────────────

export type TxState = "pending" | "not_completed" | "paid" | "refund_due" | "refunded" | "disputed" | "reversed";

/**
 * A purchase's status as the subscriber reads it. Only `settle_sub_purchase` (a charge Paystack
 * verified on the server) ever sets 'paid' — a return URL, a browser flag or an initiated row
 * never reads as paid here.
 */
export function txState(status: string, createdAt: string, now: number): TxState {
  switch (status) {
    case "paid":
    case "refund_due":
    case "refunded":
    case "disputed":
    case "reversed":
      return status;
    case "initiated":
      return now - Date.parse(createdAt) < PENDING_PAYMENT_MS ? "pending" : "not_completed";
    default:
      // 'failed', or anything this build doesn't know: never shown as money taken
      return "not_completed";
  }
}

export const TX_LABEL: Record<TxState, string> = {
  pending: "Pending",
  not_completed: "Not completed",
  paid: "Paid",
  refund_due: "Refund due",
  refunded: "Refunded",
  disputed: "Disputed",
  reversed: "Reversed",
};

export const TX_NOTE: Record<TxState, string> = {
  pending: "Not confirmed yet. If you completed the payment, it is checked with Paystack automatically.",
  not_completed: "No payment was confirmed for this checkout. You were not charged by Frenz for it.",
  paid: "Payment confirmed by Paystack.",
  refund_due: "Payment received after the creator removed you, so no access was given. A refund is owed to you.",
  refunded: "This payment was refunded. The access it bought was taken back.",
  disputed: "This payment was disputed with your bank. The access it bought was taken back.",
  reversed: "This payment was reversed. The access it bought was taken back.",
};

/** A receipt exists only where money actually moved (a verified charge, possibly refunded since). */
export function isReceipt(state: TxState): boolean {
  return state !== "pending" && state !== "not_completed";
}

/** Our own reference, shortened for display: enough to quote to support, nothing a third party could use. */
export function maskReference(ref: string): string {
  const tail = ref.replace(/^frenz_sub_/, "").slice(-10).toUpperCase();
  return tail ? `SUB-…${tail}` : "—";
}

/** The amount in the currency actually charged (Paystack minor units: 1/100). */
export function chargedAmount(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export interface TxRow {
  id: string;
  creatorId: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  reversedAt: string | null;
  priceCents: number;
  feeCents: number;
  totalCents: number;
  chargedCurrency: string;
  chargedMinor: number;
  periodDays: number;
  periodStart: string | null;
  periodEnd: string | null;
  reference: string;
}

/** What the browser receives for one transaction. No provider ids, checkout links or failure internals. */
export interface TxView {
  id: string;
  creatorId: string;
  state: TxState;
  label: string;
  note: string;
  date: string;
  /** the charged amount, in the charged currency — null where nothing was confirmed */
  charged: string | null;
  /** what the price was in USD: creator share + service fee */
  breakdown: { price: string; fee: string; total: string };
  periodDays: number;
  periodStart: string | null;
  periodEnd: string | null;
  reversedAt: string | null;
  reference: string;
  receipt: boolean;
}

export function txView(r: TxRow, now: number): TxView {
  const state = txState(r.status, r.createdAt, now);
  const confirmed = isReceipt(state);
  return {
    id: r.id,
    creatorId: r.creatorId,
    state,
    label: TX_LABEL[state],
    note: TX_NOTE[state],
    date: (confirmed ? r.paidAt : null) ?? r.createdAt,
    charged: confirmed ? chargedAmount(r.chargedMinor, r.chargedCurrency) : null,
    breakdown: { price: usd(r.priceCents), fee: usd(r.feeCents), total: usd(r.totalCents) },
    periodDays: r.periodDays,
    // a period is shown only for a payment that actually granted one
    periodStart: confirmed && state !== "refund_due" ? r.periodStart : null,
    periodEnd: confirmed && state !== "refund_due" ? r.periodEnd : null,
    reversedAt: r.reversedAt,
    reference: maskReference(r.reference),
    receipt: confirmed,
  };
}

// ─── Reminders ───────────────────────────────────────────────────────────────

export type ReminderKind = "renew_3d" | "renew_1d" | "expired";

/**
 * Which reminder a paid membership is due, given where its period stands. Only the most
 * relevant one: a membership first seen with 20 hours left gets "tomorrow", never a late
 * "in 3 days". The expiry notice is sent within two days of the end, never weeks later.
 */
export function reminderDue(periodEnd: string, now: number): ReminderKind | null {
  const left = Date.parse(periodEnd) - now;
  if (left > RENEW_WINDOW_DAYS * DAY) return null;
  if (left > DAY) return "renew_3d";
  if (left > 0) return "renew_1d";
  if (left > -2 * DAY) return "expired";
  return null;
}

export function reminderCopy(kind: ReminderKind, creatorName: string, canRenew: boolean): { title: string; body: string } {
  const renew = canRenew ? " Renew any time from Subscriptions to keep access." : "";
  switch (kind) {
    case "renew_3d":
      return { title: `Your subscription to ${creatorName} ends in 3 days`, body: `It doesn't renew automatically.${renew}` };
    case "renew_1d":
      return { title: `Your subscription to ${creatorName} ends tomorrow`, body: `It doesn't renew automatically.${renew}` };
    case "expired":
      return { title: `Your subscription to ${creatorName} has ended`, body: canRenew ? "Renew from Subscriptions to see their exclusive posts again." : "Their exclusive posts are locked again." };
  }
}

/** The creator's own view of a subscriber's status: no money, no reasons beyond what they need. */
export function creatorStatusLabel(state: SubState): string {
  switch (state) {
    case "active":
      return "Active";
    case "ending":
      return "Ending";
    case "pending":
    case "expired":
      return "Expired";
    case "refunded":
      return "Refunded";
    case "ended":
      return "Left";
    case "removed":
      return "Removed";
    case "unavailable":
      return "Blocked";
  }
}

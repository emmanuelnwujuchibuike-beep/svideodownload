/**
 * What each wallet screen may offer, decided from what the SERVER said (the wallet summary, a quote, a route's answer).
 * Pure: the screens render these and the tests pin them. Nothing here grants anything — every route checks again.
 */
import type { ApiFail, EntryKind, WalletSummary } from "./api";

export type Gate = { open: true } | { open: false; reason: "disabled" | "pin_not_set" | "pin_locked" | "authorization_unavailable" | "payout_rate" | "suspended"; title: string; message: string; action?: { href: string; label: string } };

const SET_PIN = { href: "/wallet/security", label: "Set up your PIN" };

/** Can this member start a transfer? The summary's own `canSend` / `blockedBy` decide; this only words it. */
export function transferGate(s: WalletSummary): Gate {
  if (!s.enabled || !s.transfers.enabled || s.transfers.blockedBy === "disabled") return { open: false, reason: "disabled", title: "Transfers aren't available", message: "Sending Frenz Coin isn't switched on right now. Your balance is safe." };
  if (s.transfers.blockedBy === "pin_not_set") return { open: false, reason: "pin_not_set", title: "Set up a transaction PIN first", message: "Transfers are confirmed with a 6-digit PIN that only you know.", action: SET_PIN };
  if (s.transfers.blockedBy === "pin_locked") return { open: false, reason: "pin_locked", title: "Your PIN is locked for now", message: lockedMessage(s.transfers.pin.lockedUntil), action: { href: "/wallet/security", label: "Reset your PIN" } };
  if (s.transfers.blockedBy === "authorization_unavailable") return { open: false, reason: "authorization_unavailable", title: "Transfers are paused", message: "Transfers can't be confirmed right now. Nothing has been sent. Try again later." };
  if (!s.transfers.canSend) return { open: false, reason: "suspended", title: "Transfers aren't available on your account", message: "Sending is unavailable for your wallet right now. Contact support if you think this is a mistake." };
  return { open: true };
}

/** Can this member request a withdrawal? Off, no approved payout rate, or no usable PIN → no. */
export function withdrawGate(s: WalletSummary): Gate {
  if (!s.enabled || !s.withdrawals.enabled) return { open: false, reason: "disabled", title: "Withdrawals aren't available", message: "Withdrawing Frenz Coin isn't switched on right now. Your balance is safe." };
  if (!s.withdrawals.payoutRateApproved) return { open: false, reason: "payout_rate", title: "Withdrawals aren't open yet", message: "Bank payouts start once a payout exchange rate is approved. Your coins stay in your wallet until then." };
  if (!s.transfers.pin.set) return { open: false, reason: "pin_not_set", title: "Set up a transaction PIN first", message: "Withdrawals are confirmed with a 6-digit PIN that only you know.", action: SET_PIN };
  if (s.transfers.pin.lockedUntil && Date.parse(s.transfers.pin.lockedUntil) > Date.now()) return { open: false, reason: "pin_locked", title: "Your PIN is locked for now", message: lockedMessage(s.transfers.pin.lockedUntil), action: { href: "/wallet/security", label: "Reset your PIN" } };
  if (s.transfers.blockedBy === "authorization_unavailable") return { open: false, reason: "authorization_unavailable", title: "Withdrawals are paused", message: "Withdrawals can't be confirmed right now. Nothing has been held. Try again later." };
  return { open: true };
}

/** Can this member start a deposit? */
export function depositGate(s: WalletSummary): Gate {
  if (!s.enabled || !s.deposits.enabled) return { open: false, reason: "disabled", title: "Deposits aren't available", message: "Adding Frenz Coin isn't switched on right now." };
  return { open: true };
}

function lockedMessage(until: string | null): string {
  if (!until) return "Too many wrong PINs. Wait a while, or reset your PIN by email.";
  const t = new Date(until);
  return `Too many wrong PINs. You can try again after ${t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}, or reset your PIN by email.`;
}

/** An amount the member typed, checked against the server's published limits (the route checks again). */
export function amountProblem(cents: number | null, limits: { minCents: number; maxCents: number }, availableCents?: number, needCents?: number): string | null {
  if (cents == null) return "Enter an amount, like 25 or 25.50.";
  if (cents < limits.minCents) return `The smallest amount is ${(limits.minCents / 100).toFixed(2)} FC.`;
  if (cents > limits.maxCents) return `The largest amount is ${(limits.maxCents / 100).toFixed(2)} FC.`;
  if (availableCents != null && (needCents ?? cents) > availableCents) return "That's more than your available balance.";
  return null;
}

/** What came back from the deposit return check, in words. A redirect alone never says "paid". */
export function depositVerifyView(status: "on_hold" | "pending" | "failed" | "review" | "not_found" | "error"): { tone: "success" | "info" | "error" | "warn"; title: string; message: string; final: boolean } {
  switch (status) {
    case "on_hold":
      return { tone: "success", title: "Payment confirmed", message: "Your coins are in your wallet, on hold for safety. They become spendable when the hold ends.", final: true };
    case "pending":
      return { tone: "info", title: "Confirming your payment", message: "We haven't had confirmation from the payment provider yet. Nothing is lost — your coins appear as soon as it's confirmed.", final: false };
    case "failed":
      return { tone: "error", title: "The payment didn't go through", message: "Nothing was added and you weren't charged by Frenz. You can try again.", final: true };
    case "review":
      return { tone: "warn", title: "We're checking this payment", message: "Something about this payment needs a closer look. Our team will review it — you don't need to pay again.", final: true };
    case "not_found":
      return { tone: "error", title: "We couldn't find that deposit", message: "The link doesn't match a deposit on your account. If you paid, it will still show up here once confirmed.", final: true };
    default:
      return { tone: "error", title: "Couldn't check right now", message: "Your payment isn't affected. Check again in a moment.", final: false };
  }
}

/** A coin withdrawal's status, worded for the member (reversed = the bank sent it back, coins returned). */
export function withdrawalStatusView(status: string): { label: string; badge: string; message: string } {
  switch (status) {
    case "pending":
    case "reviewing":
      return { label: "In review", badge: "reviewing", message: "Your coins are held while we review the request." };
    case "approved":
    case "processing":
      return { label: "Processing", badge: "processing", message: "Approved and being paid to your bank." };
    case "completed":
      return { label: "Paid", badge: "completed", message: "Paid to your bank account." };
    case "rejected":
      return { label: "Not approved", badge: "rejected", message: "This request wasn't approved. The held coins went back to your wallet." };
    case "cancelled":
      return { label: "Cancelled", badge: "cancelled", message: "Cancelled. The held coins went back to your wallet." };
    case "reversed":
      return { label: "Returned by bank", badge: "returned", message: "Your bank sent the payment back. The coins were returned to your wallet." };
    default:
      return { label: status, badge: status, message: "" };
  }
}

/** Whether an activity row is money in or money out (the Activity filter chips). */
export function entryDirection(kind: EntryKind, amountCents: number): "in" | "out" {
  if (kind === "deposit" || kind === "transfer_in" || kind === "withdrawal_reversal" || kind === "refund") return "in";
  if (kind === "transfer_out" || kind === "transfer_fee" || kind === "withdrawal") return "out";
  return amountCents >= 0 ? "in" : "out";
}

/** A failed call, worded for the member. The PIN never gets a hint about why it was refused. */
export function failMessage(f: ApiFail, action: "transfer" | "withdrawal" | "deposit" | "pin" | "load"): string {
  if (f.session === "expired") return "Your session ended. Sign in again to continue.";
  if (f.reason === "authorization_failed") return action === "withdrawal" ? "That PIN wasn't accepted. Check it, or try again later. Nothing was held." : "That PIN wasn't accepted. Check it, or try again later. Nothing was sent.";
  if (f.status === 429) return "Too many attempts — wait a moment, then try again.";
  if (f.status === 0) return f.error;
  return f.error || "Something went wrong. Nothing was changed.";
}

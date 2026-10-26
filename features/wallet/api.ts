/**
 * The wallet's calls to the existing Frenz Coin APIs (app/api/coin/*, app/api/ai/wallet/transfer/lookup,
 * app/api/rewards/banks). Typed to the shapes those routes actually return. The server decides every amount, fee,
 * balance and status: these only carry what the member typed and show what came back.
 *
 * Every call answers `{ ok: true, data }` or `{ ok: false, … }` — never throws. A 401 is `session: "expired"`, so a
 * screen can offer "sign in again" instead of a generic error. `error` is the server's own wording when it sent one.
 */

import type { TransferFeeRules } from "./money";

export type ApiFail = { ok: false; status: number; reason: string | null; error: string; session?: "expired" };
export type ApiResult<T> = { ok: true; data: T } | ApiFail;

const OFFLINE = "Couldn't reach Frenz. Check your connection and try again.";

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  } catch (e) {
    // the owning screen went away (or a newer request replaced this one): not an error anyone should see
    if (init?.signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return { ok: false, status: 0, reason: "aborted", error: "" };
    return { ok: false, status: 0, reason: "network", error: OFFLINE };
  }
  const json = (await res.json().catch(() => null)) as (Record<string, unknown> & { error?: string; reason?: string }) | null;
  if (res.status === 401) return { ok: false, status: 401, reason: "session", error: "Your session ended. Sign in again to continue.", session: "expired" };
  if (!res.ok) return { ok: false, status: res.status, reason: typeof json?.reason === "string" ? json.reason : null, error: typeof json?.error === "string" ? json.error : "Something went wrong. Nothing was changed." };
  return { ok: true, data: (json ?? {}) as T };
}

const post = <T>(url: string, body: unknown, signal?: AbortSignal) => call<T>(url, { method: "POST", body: JSON.stringify(body), signal });
const get = <T>(url: string, signal?: AbortSignal) => call<T>(url, signal ? { signal } : undefined);

/** True when a failed call was only cancelled (screen left, or superseded) — show nothing. */
export const wasAborted = (r: ApiResult<unknown>) => !r.ok && r.reason === "aborted";

// ── shapes (as the routes return them) ──────────────────────────────────────

export interface WalletSummary {
  enabled: boolean;
  currency: "USD";
  centsPerCoin: number;
  walletNumber: string | null;
  availableCents: number;
  pendingCents: number;
  heldCents: number;
  totalCents: number;
  pendingDeposits: { amountCents: number; settledAt: string; releaseAt: string; status: "held" | "disputed" }[];
  nextReleaseAt: string | null;
  deposits: { enabled: boolean; holdHours: number; minCents: number; maxCents: number };
  transfers: { enabled: boolean; canSend: boolean; blockedBy: "disabled" | "authorization_unavailable" | "pin_not_set" | "pin_locked" | null; pin: { set: boolean; lockedUntil: string | null }; minCents: number; maxCents: number; dailyMaxCents: number; feeExamples: { amountCents: number; feeCents: number; totalCents: number }[]; fee: TransferFeeRules };
  withdrawals: { enabled: boolean; percentBp: number; flatCents: number; minCents: number; maxCents: number; payoutRateApproved: boolean; example: { grossCents: number; feeCents: number; netCents: number } };
}

export type EntryKind = "deposit" | "transfer_in" | "transfer_out" | "transfer_fee" | "withdrawal" | "withdrawal_reversal" | "reversal" | "refund" | "adjustment";
export type EntryStatus = "pending" | "completed" | "processing" | "held" | "reversed" | "returned";
export interface HistoryEntry {
  id: string;
  kind: EntryKind;
  title: string;
  amountCents: number;
  status: EntryStatus;
  at: string;
  releaseAt: string | null;
  transferId: string | null;
  counterparty: { handle: string | null; name: string | null } | null;
}
export interface HistoryPage {
  items: HistoryEntry[];
  next: string | null;
}

export interface CoinWithdrawal {
  id: string;
  status: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  payout: { currency: string; minor: number } | null;
  bank: { name: string | null; last4: string | null };
  createdAt: string;
  updatedAt: string | null;
}

export interface PinState {
  available: boolean;
  set: boolean;
  lockedUntil: string | null;
}

export interface TransferQuote {
  kind: "transfer";
  amountCents: number;
  percentCents: number;
  flatCents: number;
  feeCents: number;
  totalCents: number;
  bracket: "below" | "mid" | "above";
}
export interface WithdrawalQuote {
  kind: "withdrawal";
  grossCents: number;
  feeCents: number;
  netCents: number;
  payoutRateApproved: boolean;
}

// ── calls ───────────────────────────────────────────────────────────────────

export const walletApi = {
  summary: (signal?: AbortSignal) => get<WalletSummary>("/api/coin/wallet", signal),
  history: (cursor: string | null, limit = 20, signal?: AbortSignal) => get<HistoryPage>(`/api/coin/history?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal),
  quote: (kind: "transfer" | "withdrawal", amountCents: number, signal?: AbortSignal) => get<TransferQuote | WithdrawalQuote>(`/api/coin/quote?kind=${kind}&amountCents=${amountCents}`, signal),
  lookup: (number: string, signal?: AbortSignal) => get<{ ok: true; name: string; handle: string | null; avatarUrl: string | null }>(`/api/ai/wallet/transfer/lookup?number=${encodeURIComponent(number)}`, signal),
  transfer: (b: { accountNumber: string; amountCents: number; idempotencyKey: string; note: string | null; pin: string }) =>
    post<{ ok: true; transferId: string; amountCents: number; feeCents: number; totalCents: number; duplicate: boolean }>("/api/coin/transfers", b),
  deposit: (b: { amountCents: number; idempotencyKey: string }) => post<{ ok: true; url: string; reference: string; amountCents: number; holdHours: number; reused: boolean }>("/api/coin/deposits", b),
  verifyDeposit: (reference: string, signal?: AbortSignal) => post<{ status: "on_hold" | "pending" | "failed" | "review"; amountCents?: number; releaseAt?: string }>("/api/coin/deposits/verify", { reference }, signal),
  withdrawals: (signal?: AbortSignal) => get<{ items: CoinWithdrawal[] }>("/api/coin/withdrawals", signal),
  withdraw: (b: { grossCents: number; bankCode: string; bankName: string; accountNumber: string; idempotencyKey: string; pin: string }) =>
    post<{ ok: true; id: string; grossCents: number; feeCents: number; netCents: number; duplicate: boolean }>("/api/coin/withdrawals", b),
  banks: (signal?: AbortSignal) => get<{ banks: { name: string; code: string }[] }>("/api/rewards/banks", signal),
  pinState: (signal?: AbortSignal) => get<PinState>("/api/coin/pin", signal),
  setPin: (pin: string, confirm: string) => post<{ ok: true }>("/api/coin/pin", { pin, confirm }),
  changePin: (currentPin: string, pin: string, confirm: string) => post<{ ok: true }>("/api/coin/pin/change", { currentPin, pin, confirm }),
  requestReset: () => post<{ ok: true; message: string }>("/api/coin/pin/reset", {}),
  confirmReset: (code: string, pin: string, confirm: string) => post<{ ok: true }>("/api/coin/pin/reset/confirm", { code, pin, confirm }),
};

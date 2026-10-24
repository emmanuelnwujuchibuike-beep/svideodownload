import "server-only";

import { timingSafeEqual } from "node:crypto";

import { getFlutterwaveConfig, type FlutterwaveConfig } from "@/lib/flutterwave/config";
import type { ChargeStatus, VerifiedCharge } from "@/lib/payments/charge";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A MINIMAL FLUTTERWAVE v3 CLIENT (Part 2) — fetch, no SDK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Checked against the official docs on 2026-10-23:
 *   · hosted checkout ("Flutterwave Standard"): POST /v3/payments with tx_ref,
 *     amount, currency, redirect_url, customer.email → `data.link`;
 *   · the customer comes back to redirect_url with ?status=&tx_ref=&transaction_id=
 *     — a hint only, never proof;
 *   · verify: GET /v3/transactions/{id}/verify and
 *     GET /v3/transactions/verify_by_reference?tx_ref=… → data.{id, tx_ref, status,
 *     amount, currency, payment_type, created_at, processor_response};
 *   · webhooks carry the dashboard's secret hash in the `verif-hash` header (a static
 *     shared secret, not an HMAC), so a webhook is only a NUDGE: value is granted
 *     only after the server re-verifies the transaction with the API.
 *
 * ⚠️ `amount` is sent and read in MAJOR units (10.5 = $10.50) — the docs' examples
 * use major units but do not state it. Until a sandbox charge confirms it, the capability
 * gate stays closed (FLUTTERWAVE_AMOUNT_UNIT must be set to "major" by the operator — see
 * lib/flutterwave/config.ts). Only two-decimal currencies are accepted, and the conversion
 * is exact decimal parsing (no float rounding).
 */

const BASE = "https://api.flutterwave.com/v3";
const TIMEOUT_MS = 15_000;

/** Currencies whose minor unit is 1/100 — the only ones this client converts. */
const TWO_DECIMAL = new Set(["USD", "NGN", "GHS", "KES", "ZAR", "EUR", "GBP"]);

/** Flutterwave ANSWERED with a refusal; `httpStatus` says whose fault (4xx: a decision, 5xx: Flutterwave failing). */
export class FlutterwaveHttpError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "FlutterwaveHttpError";
  }
}

/** We refused BEFORE calling Flutterwave (bad input): certainly nothing was created there. */
export class FlutterwaveLocalRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlutterwaveLocalRefusal";
  }
}

/**
 * Did the request DEFINITELY not create anything? Only a 4xx answer from Flutterwave, or our own
 * refusal before calling it. A 5xx, a timeout, a dropped connection or a body that is not JSON is
 * UNKNOWN — the caller must not open a second rail; it holds the attempt and reconciles it.
 */
export function flutterwaveFailureIsDefinite(e: unknown): boolean {
  if (e instanceof FlutterwaveLocalRefusal) return true;
  return e instanceof FlutterwaveHttpError && e.httpStatus >= 400 && e.httpStatus < 500;
}

type Fetch = typeof fetch;

async function request<T>(path: string, init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<T> {
  const cfg = deps.cfg ?? (await getFlutterwaveConfig());
  if (!cfg.secretKey) throw new FlutterwaveLocalRefusal("Flutterwave is not configured");
  const res = await (deps.fetch ?? fetch)(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  // a non-JSON body (an HTML 5xx page) throws SyntaxError here: unknown, by design
  const json = (await res.json()) as { status?: string; message?: string } & T;
  if (!res.ok || json.status !== "success") throw new FlutterwaveHttpError(typeof json.message === "string" ? json.message.slice(0, 200) : `Flutterwave ${path} failed`, res.status);
  return json;
}

export function minorToMajor(minor: number, currency: string): number {
  if (!TWO_DECIMAL.has(currency.toUpperCase())) throw new FlutterwaveLocalRefusal(`unsupported currency ${currency}`);
  if (!Number.isInteger(minor) || minor <= 0) throw new FlutterwaveLocalRefusal("amount must be a positive whole number of minor units");
  return minor / 100;
}

/**
 * A provider's major-unit amount → integer minor units, EXACTLY (Part 2.1). Parsed as a decimal
 * string, never by float multiplication and rounding: "10.5" → 1050, "19.99" → 1999, but "10.005"
 * (finer than the currency's two decimals) or anything malformed is null — unreadable, so it can
 * never match an attempt. JSON numbers print in their shortest exact form, so 19.99 stays "19.99".
 */
export function majorToMinor(major: unknown, currency: string | null): number | null {
  if (!currency || !TWO_DECIMAL.has(currency.toUpperCase())) return null;
  const text = typeof major === "number" ? (Number.isFinite(major) ? String(major) : "") : typeof major === "string" ? major.trim() : "";
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/* ─────────────────────────────── checkout ─────────────────────────────── */

export interface FlutterwaveCheckoutInput {
  reference: string;
  amountMinor: number;
  currency: string;
  email: string;
  redirectUrl: string;
  title: string;
  /** Echoed back; informational only — settlement never reads it. */
  meta?: Record<string, string | number | null>;
  /** A Flutterwave PAYMENT PLAN id: the first charge subscribes the customer (card only — the checkout offers card). */
  paymentPlan?: string;
}

/** Opens a hosted checkout and returns its link. Throws; classify with `flutterwaveFailureIsDefinite`. */
export async function createFlutterwaveCheckout(input: FlutterwaveCheckoutInput, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<string> {
  const amount = minorToMajor(input.amountMinor, input.currency);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.reference)) throw new FlutterwaveLocalRefusal("bad reference");
  const out = await request<{ data?: { link?: string } }>(
    "/payments",
    {
      method: "POST",
      body: {
        tx_ref: input.reference,
        amount,
        currency: input.currency.toUpperCase(),
        redirect_url: input.redirectUrl,
        customer: { email: input.email },
        customizations: { title: input.title },
        meta: input.meta ?? {},
        // payment plans charge cards only (Flutterwave docs): offer card, so nobody starts a method that can't subscribe
        ...(input.paymentPlan ? { payment_plan: Number(input.paymentPlan), payment_options: "card" } : {}),
      },
    },
    deps,
  );
  const link = out.data?.link;
  // a "success" with no link is not a refusal we understand: unknown, never a fallback
  if (typeof link !== "string" || !/^https:\/\//.test(link)) throw new FlutterwaveHttpError("checkout answered without a link", 502);
  return link;
}

/* ─────────────────────────────── verification ─────────────────────────────── */

interface RawTransaction {
  id?: number | string;
  tx_ref?: string;
  status?: string;
  amount?: number | string;
  currency?: string;
  payment_type?: string;
  created_at?: string;
  processor_response?: string;
  customer?: { email?: string } | null;
}

/** Flutterwave's words → ours. Anything unrecognised is PENDING (never final). */
export function mapFlutterwaveStatus(status: unknown): ChargeStatus {
  switch (String(status ?? "").toLowerCase()) {
    case "successful":
      return "success";
    case "failed":
      return "failed";
    case "cancelled":
      return "abandoned";
    default:
      return "pending";
  }
}

export function toVerifiedCharge(t: RawTransaction): VerifiedCharge {
  const currency = typeof t.currency === "string" ? t.currency.toUpperCase() : null;
  return {
    provider: "flutterwave",
    reference: typeof t.tx_ref === "string" ? t.tx_ref : null,
    externalId: t.id !== undefined && t.id !== null ? String(t.id) : null,
    status: mapFlutterwaveStatus(t.status),
    amountMinor: majorToMinor(t.amount, currency),
    currency,
    channel: typeof t.payment_type === "string" ? t.payment_type : null,
    paidAt: typeof t.created_at === "string" ? t.created_at : null,
    reason: typeof t.processor_response === "string" ? t.processor_response.slice(0, 120) : null,
    customerEmail: typeof t.customer?.email === "string" ? t.customer.email.trim().toLowerCase() : null,
  };
}

const notFound = (reference: string | null, externalId: string | null): VerifiedCharge => ({ provider: "flutterwave", reference, externalId, status: "not_found", amountMinor: null, currency: null, channel: null, paidAt: null, reason: null });

/** A 400/404 from verify means "no such transaction"; any other refusal (401, 403…) is a real error. */
const isNotFound = (e: unknown) => e instanceof FlutterwaveHttpError && (e.httpStatus === 400 || e.httpStatus === 404);

/** Verify by Flutterwave's transaction id (the webhook's data.id, the return's transaction_id). */
export async function verifyFlutterwaveById(id: string, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<VerifiedCharge> {
  if (!/^\d{1,20}$/.test(id)) throw new FlutterwaveLocalRefusal("bad transaction id");
  try {
    const out = await request<{ data?: RawTransaction }>(`/transactions/${id}/verify`, {}, deps);
    return toVerifiedCharge(out.data ?? {});
  } catch (e) {
    if (isNotFound(e)) return notFound(null, id);
    throw e;
  }
}

/** Verify by OUR reference (tx_ref) — for a member who never came back, or a reconcile. */
export async function verifyFlutterwaveByReference(reference: string, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<VerifiedCharge> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(reference)) throw new FlutterwaveLocalRefusal("bad reference");
  try {
    const out = await request<{ data?: RawTransaction }>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, {}, deps);
    return toVerifiedCharge(out.data ?? {});
  } catch (e) {
    if (isNotFound(e)) return notFound(reference, null);
    throw e;
  }
}

/* ─────────────────────────────── webhooks ─────────────────────────────── */

/**
 * The `verif-hash` header must equal the secret hash set in the dashboard. Constant-time; a
 * missing secret or header is a refusal. Proves the SENDER only — the event's content is
 * still re-verified with the API before anything is granted.
 */
export function verifyFlutterwaveWebhookWith(header: string | null, cfg: FlutterwaveConfig): boolean {
  if (!cfg.secretHash || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(cfg.secretHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The webhook check against the effective configuration (admin-set hash first, env fallback). */
export async function verifyFlutterwaveWebhook(header: string | null): Promise<boolean> {
  return verifyFlutterwaveWebhookWith(header, await getFlutterwaveConfig());
}

/* ─────────────────────────────── payment plans & subscriptions ─────────────────────────────── */

export interface FlutterwavePlanFacts {
  id: string;
  name: string;
  /** Minor units (from the plan's major-unit amount); null when the plan has no fixed amount. */
  amountMinor: number | null;
  currency: string;
  interval: string;
  active: boolean;
}

/** GET /v3/payment-plans/{id} — what Flutterwave will charge for a plan, read before a checkout and to check a renewal. */
export async function readFlutterwavePlan(id: string, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<FlutterwavePlanFacts> {
  if (!/^\d{1,12}$/.test(id)) throw new FlutterwaveLocalRefusal("bad plan id");
  const out = await request<{ data?: { id?: number | string; name?: string; amount?: number | string | null; currency?: string; interval?: string; status?: string } }>(`/payment-plans/${id}`, {}, deps);
  const d = out.data ?? {};
  const currency = typeof d.currency === "string" ? d.currency.toUpperCase() : "";
  return {
    id: String(d.id ?? id),
    name: typeof d.name === "string" ? d.name.slice(0, 80) : "",
    amountMinor: d.amount === null || d.amount === undefined || d.amount === 0 ? null : majorToMinor(d.amount, currency),
    currency,
    interval: typeof d.interval === "string" ? d.interval : "",
    active: String(d.status ?? "active").toLowerCase() === "active",
  };
}

export interface FlutterwaveSubscription {
  id: string;
  status: string;
  plan: string;
  email: string;
  /** The subscription's own amount as Flutterwave reports it (major units, like every amount here); null when absent. */
  amount: number | null;
}

/**
 * GET /v3/subscriptions — subscriptions are tied to the customer's email. Filters (docs, 2026-10-23): email, plan,
 * status (active | cancelled), transaction_id — documented as the FIRST charge's id; whether it also finds a renewal's
 * id is NOT documented (see renewalLookupConfirmed). At least an email or a transaction id is required.
 */
export async function findFlutterwaveSubscriptions(q: { email?: string; plan?: string; status?: "active" | "cancelled"; transactionId?: string }, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<FlutterwaveSubscription[]> {
  const params = new URLSearchParams();
  if (q.email) params.set("email", q.email);
  if (q.plan) params.set("plan", q.plan);
  if (q.status) params.set("status", q.status);
  if (q.transactionId) {
    if (!/^\d{1,20}$/.test(q.transactionId)) throw new FlutterwaveLocalRefusal("bad transaction id");
    params.set("transaction_id", q.transactionId);
  }
  if (!q.email && !q.transactionId) throw new FlutterwaveLocalRefusal("a subscription lookup needs an email or a transaction id");
  const out = await request<{ data?: { id?: number | string; status?: string; plan?: number | string; amount?: number | string | null; customer?: { customer_email?: string } }[] }>(`/subscriptions?${params.toString()}`, {}, deps);
  return (out.data ?? [])
    .map((s) => ({
      id: String(s.id ?? ""),
      status: String(s.status ?? "").toLowerCase(),
      plan: String(s.plan ?? ""),
      email: String(s.customer?.customer_email ?? "").toLowerCase(),
      amount: s.amount === null || s.amount === undefined || s.amount === "" ? null : Number(s.amount),
    }))
    .filter((s) => /^\d+$/.test(s.id));
}

export interface FlutterwaveTransactionSummary {
  id: string;
  txRef: string | null;
  status: string;
  email: string | null;
}

/**
 * GET /v3/transactions (docs, 2026-10-23): from + to (YYYY-MM-DD, required), page, customer_email, status; paging in
 * meta.page_info.total_pages. A LIST is only a lead — every candidate is re-verified by id before anything is decided.
 */
export async function listFlutterwaveTransactions(q: { from: string; to: string; customerEmail: string; status?: "successful"; page?: number }, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<{ items: FlutterwaveTransactionSummary[]; totalPages: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to)) throw new FlutterwaveLocalRefusal("bad date window");
  const params = new URLSearchParams({ from: q.from, to: q.to, customer_email: q.customerEmail, page: String(Math.max(1, Math.floor(q.page ?? 1))) });
  if (q.status) params.set("status", q.status);
  const out = await request<{ data?: { id?: number | string; tx_ref?: string; status?: string; customer_email?: string; customer?: { email?: string } }[]; meta?: { page_info?: { total_pages?: number } } }>(`/transactions?${params.toString()}`, {}, deps);
  const items = (out.data ?? [])
    .map((t) => ({ id: String(t.id ?? ""), txRef: typeof t.tx_ref === "string" ? t.tx_ref : null, status: String(t.status ?? "").toLowerCase(), email: (t.customer_email ?? t.customer?.email ?? null)?.toLowerCase() ?? null }))
    .filter((t) => /^\d{1,20}$/.test(t.id));
  const totalPages = Number(out.meta?.page_info?.total_pages);
  return { items, totalPages: Number.isFinite(totalPages) && totalPages > 0 ? Math.floor(totalPages) : 1 };
}

/** PUT /v3/subscriptions/{id}/cancel — stop future charges (the member keeps the period already paid). */
export async function cancelFlutterwaveSubscription(id: string, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<void> {
  if (!/^\d{1,20}$/.test(id)) throw new FlutterwaveLocalRefusal("bad subscription id");
  await request(`/subscriptions/${id}/cancel`, { method: "PUT" }, deps);
}

// ─── Transfers (payouts) — 2026-10-24, owner: Exclusive withdrawals go out through Flutterwave ─────────────────────

/** The account holder Flutterwave's bank lookup names for an account (POST /v3/accounts/resolve). */
export async function resolveFlutterwaveAccount(accountNumber: string, bankCode: string, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<string> {
  const r = await request<{ data?: { account_name?: string } }>("/accounts/resolve", { method: "POST", body: { account_number: accountNumber, account_bank: bankCode } }, deps);
  const name = r.data?.account_name;
  if (typeof name !== "string" || !name.trim()) throw new FlutterwaveHttpError("No account name returned", 422);
  return name.trim();
}

/**
 * Send a naira bank transfer (POST /v3/transfers). `reference` is fixed per withdrawal: Flutterwave refuses a second
 * transfer with it, so a retry can never pay twice. Answers Flutterwave's own status (NEW / PENDING / SUCCESSFUL / FAILED).
 */
export async function createFlutterwaveTransfer(input: { reference: string; amountMinor: number; bankCode: string; accountNumber: string; narration: string }, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<{ status: string; id: string | null }> {
  const r = await request<{ data?: { id?: number | string; status?: string } }>(
    "/transfers",
    { method: "POST", body: { account_bank: input.bankCode, account_number: input.accountNumber, amount: minorToMajor(input.amountMinor, "NGN"), currency: "NGN", debit_currency: "NGN", narration: input.narration.slice(0, 80), reference: input.reference } },
    deps,
  );
  return { status: String(r.data?.status ?? "NEW").toUpperCase(), id: r.data?.id !== undefined && r.data?.id !== null ? String(r.data.id) : null };
}

export type FlutterwaveTransferVerdict = { kind: "success" } | { kind: "failed"; status: string } | { kind: "not_found" } | { kind: "unknown"; status?: string };

/** What Flutterwave says about a transfer reference right now (GET /v3/transfers?reference=). Only SUCCESSFUL / FAILED / none are verdicts. */
export async function verifyFlutterwaveTransfer(reference: string, deps: { cfg?: FlutterwaveConfig; fetch?: Fetch } = {}): Promise<FlutterwaveTransferVerdict> {
  try {
    const r = await request<{ data?: { reference?: string; status?: string }[] }>(`/transfers?reference=${encodeURIComponent(reference)}`, {}, deps);
    const mine = (r.data ?? []).filter((t) => t.reference === reference);
    if (!mine.length) return { kind: "not_found" };
    const st = String(mine[0]!.status ?? "").toUpperCase();
    if (st === "SUCCESSFUL") return { kind: "success" };
    if (st === "FAILED") return { kind: "failed", status: "failed" };
    return { kind: "unknown", status: st.toLowerCase() || undefined };
  } catch {
    return { kind: "unknown" };
  }
}

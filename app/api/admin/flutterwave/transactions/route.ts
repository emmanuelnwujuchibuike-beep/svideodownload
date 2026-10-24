import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApi } from "@/lib/admin/require-admin";
import { requireSensitiveAdmin } from "@/lib/admin/reauth";
import { PAYMENT_PURPOSES, type PaymentPurpose } from "@/lib/ai/credits/wallet-config";
import { adminRecheckPayment, listAdminTransactions, RECONCILIATION_STATES, type ReconciliationState } from "@/lib/payments/admin-transactions";
import { subVerifyLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Part 5 — Admin → Flutterwave → Transactions (lib/payments/admin-transactions.ts).
 *
 * GET  — payment attempts across the existing ledgers and the provider-event log, filtered. Admin only; no secrets,
 *        no card data (the ledgers hold none).
 * POST — { reference }: recheck ONE attempt with its provider through that purpose's existing settle path. A fresh
 *        password on top of the session (it can settle money), rate limited, audited. The body carries a reference
 *        only — nothing the browser says about the payment is read.
 */

const query = z
  .object({
    provider: z.enum(["flutterwave", "paystack"]).optional(),
    purpose: z.enum(PAYMENT_PURPOSES as unknown as [PaymentPurpose, ...PaymentPurpose[]]).optional(),
    state: z.enum(RECONCILIATION_STATES as unknown as [ReconciliationState, ...ReconciliationState[]]).optional(),
    reference: z.string().trim().max(110).regex(/^frenz_[A-Za-z0-9_-]{4,100}$/, "Search by a Frenz reference (frenz_…).").optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const params = Object.fromEntries([...new URL(request.url).searchParams.entries()].filter(([, v]) => v !== ""));
  const parsed = query.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid filter." }, { status: 400 });
  try {
    const out = await listAdminTransactions(parsed.data);
    return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load payments right now." }, { status: 503 });
  }
}

const recheck = z.object({ reference: z.string().trim().max(110) }).strict();

export async function POST(request: Request) {
  const gate = await requireSensitiveAdmin();
  if (!gate.ok) return gate.response;
  const { success } = await subVerifyLimiter.limit(`admin-payment-recheck:${gate.user.id}`);
  if (!success) return NextResponse.json({ error: "Too many rechecks — wait a moment." }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = recheck.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const out = await adminRecheckPayment(parsed.data.reference, gate.user.id);
    if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.code === "not_found" ? 404 : 400 });
    return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // never the error detail: it can carry a provider's response
    return NextResponse.json({ error: "Couldn't recheck it right now. Nothing was changed by this error; try again shortly." }, { status: 503 });
  }
}

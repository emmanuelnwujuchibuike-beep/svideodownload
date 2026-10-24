import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/require-admin";
import { requireSensitiveAdmin } from "@/lib/admin/reauth";
import { applyReviewedRenewal, closeBillingReview, listBillingReviews } from "@/lib/ai/credits/flutterwave-plans";
import { getFlutterwaveConfig } from "@/lib/flutterwave/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin: Flutterwave plan billing that could not be settled automatically (Part 3.3, 0274 `plan_billing_reviews`) —
 * renewals whose subscription could not be proven, activations Flutterwave has not confirmed yet, cancellations that
 * could not be resolved, and old subscriptions still charging after an upgrade.
 *
 *   GET  ?status=open|closed   → the list (ids, amounts, reasons; never an email or card data)
 *   POST { id, action: "apply" }                       → a renewal, ONLY when Flutterwave proves at that moment which
 *                                                        stored subscription it renews (Part 3.3.2); then applied ONCE
 *                                                        through apply_plan_renewal (contract re-checked there). Never
 *                                                        on an email or an amount; no manual adjudication.
 *   POST { id, action: "resolve" | "dismiss", note }   → closed by hand
 * POST is SENSITIVE (a fresh password): applying grants a paid period.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const status = new URL(request.url).searchParams.get("status") === "closed" ? "closed" : "open";
  try {
    // whether Flutterwave CAN prove a renewal's subscription yet (the sandbox-confirmed lookup) — the UI offers "Apply"
    // only then; the server re-proves ownership on every Apply regardless (a hidden button is not a control)
    const { renewalLookupConfirmed } = await getFlutterwaveConfig();
    return NextResponse.json({ reviews: await listBillingReviews(status), renewalProofAvailable: renewalLookupConfirmed });
  } catch {
    return NextResponse.json({ error: "Reviews are unavailable. Has migration 0274 been run?" }, { status: 503 });
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({ id: z.string().uuid(), action: z.literal("apply") }).strict(),
  z.object({ id: z.string().uuid(), action: z.enum(["resolve", "dismiss"]), note: z.string().trim().max(500).default("") }).strict(),
]);

export async function POST(request: Request) {
  const gate = await requireSensitiveAdmin();
  if (!gate.ok) return gate.response;
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (parsed.data.action === "apply") {
    const out = await applyReviewedRenewal(parsed.data.id, admin.id);
    return out.ok ? NextResponse.json({ ok: true, result: out.result }) : NextResponse.json({ error: out.error }, { status: out.status });
  }
  const closed = await closeBillingReview(parsed.data.id, admin.id, parsed.data.action === "resolve" ? "resolved" : "dismissed", parsed.data.note);
  return closed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "That review is not open." }, { status: 409 });
}

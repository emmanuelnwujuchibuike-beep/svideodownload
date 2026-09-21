import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { isPaystackPlanNotFound, paystackEnabled, readPaystackPlan } from "@/lib/paystack/paystack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().trim().min(1).max(100) });

/**
 * POST /api/admin/ai/plans/verify — admin-only. Reads a plan code back from
 * Paystack (name, amount, currency, interval) so the AI Plans tab can show
 * what a member will actually be charged before the code is saved. A code
 * Paystack does not know answers a plain sentence — a payment-page slug or
 * a typo is the usual cause. Nothing is created or charged.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await paystackEnabled())) return NextResponse.json({ ok: false, error: "Paystack is not configured (Monetization → Paystack)." }, { status: 200 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a plan code." }, { status: 400 });
  const code = parsed.data.code;
  if (!/^PLN_[A-Za-z0-9]+$/.test(code)) {
    return NextResponse.json({ ok: false, error: `"${code.slice(0, 24)}" is not a plan code. A Paystack plan code starts with PLN_ (Paystack dashboard → Payments → Plans → the plan → Plan code). A payment-page link or its slug will not work.` }, { status: 200 });
  }
  try {
    const plan = await readPaystackPlan(code);
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    const notFound = isPaystackPlanNotFound(e);
    return NextResponse.json({ ok: false, error: notFound ? "Paystack does not know this plan code on the configured account (check live vs test keys, and that the plan was not archived)." : "Paystack did not answer. Try again in a moment." }, { status: 200 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { savedDetails } from "@/lib/sub/payout-account";
import { requestSubWithdrawal } from "@/lib/sub/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    grossCents: z.number().int().positive().max(100_000_000),
    idempotencyKey: z.string().min(8).max(80),
    // either the bank typed now, or the saved payout account (its number never leaves the server)
    details: z.object({ bankCode: z.string().max(10), bankName: z.string().max(120), accountNumber: z.string().max(10) }).strict().optional(),
    useSaved: z.literal(true).optional(),
    // owner 2026-10-12: creators outside Nigeria — a bank wire or PayPal, paid by hand (validated again on the server)
    international: z
      .object({
        rail: z.enum(["bank", "paypal"]),
        country: z.string().length(2),
        accountName: z.string().min(2).max(120),
        bankName: z.string().max(120).optional(),
        accountNumber: z.string().max(40).optional(),
        swift: z.string().max(11).optional(),
        email: z.string().max(254).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((b) => [b.details, b.useSaved, b.international].filter(Boolean).length === 1);

/**
 * POST — withdraw SUB money. The browser sends only the amount, the bank and a
 * replay key: the balance, the fee, the account holder's name and every rule are
 * the server's (request_sub_withdrawal, 0227). Paid through Paystack at once when
 * auto-payout is on.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`sub-withdraw:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const intl = parsed.data.international;
  const details = intl ?? (parsed.data.useSaved ? await savedDetails(user.id, false) : parsed.data.details);
  if (!details) return NextResponse.json({ ok: false, error: "Add your payout account first." }, { status: 409 });
  const out = await requestSubWithdrawal({ userId: user.id, grossCents: parsed.data.grossCents, details, idempotencyKey: parsed.data.idempotencyKey, method: intl ? "international" : "paystack" });
  return out.ok ? NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ ok: false, error: out.error, reason: out.reason }, { status: out.status });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { resolveAccount } from "@/lib/rewards/paystack-banks";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ accountNumber: z.string().regex(/^\d{10}$/), bankCode: z.string().regex(/^[0-9A-Za-z]{2,10}$/) }).strict();

/** POST — the account holder's name for a bank and account number, from Paystack. Rate-limited: it must not become an account lookup service. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { success } = await trackLimiter.limit(`resolve-account:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many checks. Wait a moment." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Enter a 10-digit account number and pick a bank." }, { status: 400 });
  const name = await resolveAccount(parsed.data.accountNumber, parsed.data.bankCode);
  return name ? NextResponse.json({ ok: true, accountName: name }) : NextResponse.json({ ok: false, error: "That account number doesn't match the bank." }, { status: 404 });
}

import { after, NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { autoWithdrawSub, deletePayoutAccount, getPayoutAccount, savePayoutAccount, setAutoWithdraw } from "@/lib/sub/payout-account";
import { subConfig } from "@/lib/sub/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function me(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** GET — the signed-in creator's saved SUB payout account, masked (bank, holder, last four digits), and the auto-withdrawal switch. */
export async function GET() {
  const id = await me();
  if (!id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const [acc, cfg] = await Promise.all([getPayoutAccount(id), subConfig()]);
  return NextResponse.json({ ...acc, feePercent: cfg.withdrawalFeePercent }, { headers: NO_STORE });
}

const body = z.union([
  z.object({ bankCode: z.string().max(10), bankName: z.string().max(120), accountNumber: z.string().max(10), autoWithdraw: z.boolean().optional() }).strict(),
  z.object({ autoWithdraw: z.boolean() }).strict(),
]);

/**
 * POST — save the beneficiary (Paystack names the holder; nothing typed is trusted)
 * or flip auto-withdrawal. Turning it on sweeps what is already available, past the
 * response, through the same SQL every withdrawal uses.
 */
export async function POST(req: Request) {
  const id = await me();
  if (!id) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`sub-payout-account:${id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests. Wait a moment." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const b = parsed.data;
  const out = "bankCode" in b ? await savePayoutAccount(id, b) : await setAutoWithdraw(id, b.autoWithdraw);
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: out.status });
  if (out.account.autoWithdraw) after(() => autoWithdrawSub(id, "enabled").then(() => undefined));
  return NextResponse.json(out, { headers: NO_STORE });
}

/** DELETE — forget the saved account (auto-withdrawal stops with it). */
export async function DELETE() {
  const id = await me();
  if (!id) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const out = await deletePayoutAccount(id);
  return out.ok ? NextResponse.json(out, { headers: NO_STORE }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { isCoinDepositReference, settleCoinDeposit } from "@/lib/coin/deposits";
import { subVerifyLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ reference: z.string().max(80) }).strict();

/**
 * POST /api/coin/deposits/verify — the member is back from the checkout (Part 4). The browser names ONE reference and
 * nothing else counts: the attempt must be theirs, and Flutterwave is asked about it by the server. A redirect is never
 * proof of payment. Settling is once per reference, so this, the webhook and the sweep racing credit once.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await subVerifyLimiter.limit(`coin-deposit-verify:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many checks — wait a moment." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isCoinDepositReference(parsed.data.reference)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  let out;
  try {
    out = await settleCoinDeposit(parsed.data.reference, { userId: user.id });
  } catch {
    // Flutterwave unreachable: nothing is decided — the webhook and the sweep keep trying
    return NextResponse.json({ status: "pending" }, { headers: { "cache-control": "no-store" } });
  }
  if (out.kind === "credited") return NextResponse.json({ status: "on_hold", amountCents: out.amountCents, releaseAt: out.releaseAt }, { headers: { "cache-control": "no-store" } });
  if (out.kind === "unknown" || out.kind === "not_ours") return NextResponse.json({ error: "No deposit has that reference." }, { status: 404 });
  const status = out.kind === "failed" ? "failed" : out.kind === "mismatch" || out.kind === "review" ? "review" : "pending";
  return NextResponse.json({ status }, { headers: { "cache-control": "no-store" } });
}

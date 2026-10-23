import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { confirmVerificationPayment } from "@/lib/social/paid-verification";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/verification/paid/confirm — the return page asks what became of ITS member's checkout (0268).
 * The browser supplies a reference, never an outcome: the answer is Paystack's verified charge, read with
 * our secret key, and the tick is granted once whoever (this or the webhook) settles it first.
 */
const body = z.object({ reference: z.string().min(10).max(100) }).strict();

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in." }, { status: 401 });
  const { success } = await trackLimiter.limit(`verification-confirm:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const status = await confirmVerificationPayment(parsed.data.reference, { userId: user.id });
  return NextResponse.json({ ok: status === "paid", status }, { headers: { "Cache-Control": "private, no-store" } });
}

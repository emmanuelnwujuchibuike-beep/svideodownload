import { NextResponse } from "next/server";
import { z } from "zod";

import { getWalletKinds, getWalletNumber, sendCredits, TRANSFER_KINDS } from "@/lib/ai/wallet/transfers";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// a wallet number, OR (from a chat) the other member's user id — the server resolves their wallet number itself
const schema = z
  .object({
    accountNumber: z.string().trim().max(14).optional(),
    recipientUserId: z.string().uuid().optional(),
    credits: z.number().int().positive().max(100_000_000),
    idempotencyKey: z.string().max(80),
    note: z.string().max(200).nullable().optional(),
    // 0199 (owner, 2026-10-08): which credits to send - the recipient receives the same kind
    kind: z.enum(TRANSFER_KINDS).default("usable"),
  })
  .strict()
  .refine((b) => !!b.accountNumber !== !!b.recipientUserId, { message: "one recipient" });

/** GET — what the send sheet needs when it opens outside the credits page (a chat): the rules and the balance, split by kind. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const [settings, kinds] = await Promise.all([getLandingSettings(), getWalletKinds(user.id).catch(() => null)]);
  const t = settings.frenzAiPlans.wallet.transfers;
  return NextResponse.json(
    { rules: t.enabled ? { feePercent: t.feePercent, minCredits: t.minCredits, maxCredits: t.maxCredits, dailyMaxCredits: t.dailyMaxCredits } : null, balance: kinds?.balance ?? null, withdrawable: kinds?.withdrawable ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * POST /api/ai/wallet/transfer — send credits to a wallet number, or to the
 * member on the other side of a chat (0193). The sender is the session; the
 * fee, bounds and balance are the server's; the idempotency key makes a
 * retried tap the same transfer, never a second one.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobCreateLimiter.limit(`wallet-transfer:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many transfers — wait a moment." }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (parsed.data.recipientUserId === user.id) return NextResponse.json({ error: "You can't send credits to yourself." }, { status: 400 });
  const settings = await getLandingSettings();
  const accountNumber = parsed.data.recipientUserId ? await getWalletNumber(parsed.data.recipientUserId) : (parsed.data.accountNumber ?? "").replace(/\s+/g, "");
  if (!accountNumber) return NextResponse.json({ error: "That member can't receive credits yet." }, { status: 400 });
  const out = await sendCredits({
    senderId: user.id,
    accountNumber,
    credits: parsed.data.credits,
    idempotencyKey: parsed.data.idempotencyKey,
    note: parsed.data.note ?? null,
    kind: parsed.data.kind,
    config: settings.frenzAiPlans.wallet.transfers,
  });
  if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}

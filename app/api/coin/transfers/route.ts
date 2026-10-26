import { after, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeCoinTransfer } from "@/lib/coin/authorization";
import { sendCoins } from "@/lib/coin/server";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter, clientId, pinLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    accountNumber: z.string().trim().max(14),
    amountCents: z.number().int().positive().max(100_000_000),
    idempotencyKey: z.string().max(80),
    note: z.string().max(200).nullable().optional(),
    // the member's six-digit TRANSACTION PIN (Part 4.2). Never logged, never stored, never echoed.
    pin: z.string().max(12),
    // sent from a story (2026-10-26): a label for the recipient's notification only — checked after the commit, never part of the money (lib/coin/story-gift.ts)
    storyId: z.string().uuid().optional(),
  })
  .strict();

/**
 * POST /api/coin/transfers — send Frenz Coins to a wallet number (Part 4). The sender is the session; the fee, limits,
 * balance and eligibility are the database's (transfer_coins, under the wallet locks); the idempotency key makes a retry
 * the same transfer.
 *
 * 🔴 Part 4.2: confirmed with the member's TRANSACTION PIN (lib/coin/authorization.ts, 0282). The PIN is checked IN the
 * database, in the same transaction as the transfer; wrong, locked, unset or replayed — one 403, and nothing moves.
 * Throttled per member and per IP here, and durably in the database (counted attempts, progressive locks). Fails closed
 * when anything the check needs is missing. Frenz Coin itself ships OFF (frenzCoin.enabled).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobCreateLimiter.limit(`coin-transfer:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many transfers — wait a moment." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const settings = await getLandingSettings();
  const c = settings.frenzCoin;
  if (!c.enabled || !c.transfers.enabled) return NextResponse.json({ error: "Frenz Coin isn't available right now.", reason: "disabled" }, { status: 503 });
  // PIN guesses: per member and per IP (the database counter is the durable limit behind these)
  const [byUser, byIp] = await Promise.all([pinLimiter.limit(`coin-pin:${user.id}`), pinLimiter.limit(`coin-pin-ip:${clientId(request.headers)}`)]);
  if (!byUser.success || !byIp.success) return NextResponse.json({ error: "Too many attempts — wait a moment.", reason: "rate_limited" }, { status: 429 });
  const auth = await authorizeCoinTransfer(user.id, parsed.data.pin, c);
  if (!auth.ok) {
    if (auth.reason === "unavailable") return NextResponse.json({ error: "Transfers aren't available right now. Nothing was sent.", reason: "authorization_unavailable" }, { status: 503 });
    return NextResponse.json({ error: "That PIN wasn't accepted. Check it, or try again later. Nothing was sent.", reason: "authorization_failed" }, { status: 403 });
  }
  const out = await sendCoins({
    senderId: user.id,
    accountNumber: parsed.data.accountNumber.replace(/\s+/g, ""),
    amountCents: parsed.data.amountCents,
    idempotencyKey: parsed.data.idempotencyKey,
    note: parsed.data.note ?? null,
    config: c,
    authorization: auth.authorization,
    storyId: parsed.data.storyId ?? null,
  });
  if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
  // after the commit, off the money path: a failed push never touches the transfer
  after(out.announce);
  const { announce: _announce, ...body } = out;
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}

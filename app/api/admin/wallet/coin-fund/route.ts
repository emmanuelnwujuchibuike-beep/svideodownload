import { NextResponse } from "next/server";
import { z } from "zod";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { getAdminUser } from "@/lib/admin/guard";
import { fundCoinWallet } from "@/lib/admin/lock";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual Frenz Coin funding (0301, owner 2026-10-28: "very guarded, no hack or anything should rewrite it").
 *
 *   GET  ?account=<10-digit wallet number>   who it belongs to, and the admin's fundings so far (to check before sending)
 *   POST { accountNumber, amountCents, reason, pin, idempotencyKey }
 *
 * Four locks, all on the server: an UNLOCKED dashboard (the admin lock), the account password re-entered in the last
 * ten minutes (requireFinancialAdmin), a fresh admin PIN for THIS funding, and the database's own door
 * (admin_fund_coin_wallet: the session, the PIN, caps, once per key — the only function that can credit a coin wallet
 * by hand). Each funding is an append-only record, an append-only ledger row and an audit row.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const account = new URL(request.url).searchParams.get("account") ?? "";
  const db = createAdminClient();
  const recent = await db.from("admin_coin_fundings").select("id, user_id, amount_cents, reason, created_at, admin_id").order("created_at", { ascending: false }).limit(20);
  let recipient: { name: string; handle: string | null } | null = null;
  if (/^[0-9]{10}$/.test(account)) {
    const { data: acct } = await db.from("wallet_accounts").select("user_id").eq("account_number", account).maybeSingle();
    if (acct?.user_id) {
      const { data: p } = await db.from("profiles").select("display_name, handle").eq("id", acct.user_id).maybeSingle();
      recipient = { name: (p?.display_name as string | null) || (p?.handle ? `@${p.handle}` : "Member"), handle: (p?.handle as string | null) ?? null };
    }
  }
  return NextResponse.json({ recipient, recent: recent.data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z
  .object({
    accountNumber: z.string().regex(/^[0-9]{10}$/),
    amountCents: z.number().int().positive().max(100_000),
    reason: z.string().trim().min(5).max(200),
    pin: z.string().regex(/^[0-9]{6}$/),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
  })
  .strict();

export async function POST(request: Request) {
  const gate = await requireFinancialAdmin("coin_wallet.fund", null);
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the 10-digit wallet number, an amount up to $1,000, a reason, and your PIN." }, { status: 400 });
  const { accountNumber, amountCents, reason, pin, idempotencyKey } = parsed.data;
  const out = await fundCoinWallet(gate.user.id, { pin, accountNumber, amountCents, reason, reference: idempotencyKey });
  // the database writes its own audit row on success; the refusals are recorded here (never the PIN)
  if (!out.ok) await auditAdminAction(gate.user.id, "admin_coin_funding_refused", "coin_wallet.fund", accountNumber, { reason: out.reason, amount_cents: amountCents });
  if (out.ok) return NextResponse.json(out);
  return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
}

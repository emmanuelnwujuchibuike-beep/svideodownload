import { NextResponse } from "next/server";
import { z } from "zod";

import { getWalletPrefs, setWalletPrefs } from "@/lib/coin/wallet-prefs";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET / PATCH /api/coin/preferences — the signed-in member's own wallet preferences (Wallet setup, 2026-10-26):
 * push alerts for money in, money out and withdrawal updates, and hide the balance by default. The member is the
 * session, never a parameter. Only these four booleans exist; anything else is refused. Receipts and activity are
 * kept whatever these say, and security alerts are always on (lib/coin/wallet-prefs.ts).
 */
async function member() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await member();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return NextResponse.json({ prefs: await getWalletPrefs(user.id) }, { headers: { "cache-control": "private, no-store" } });
}

const patch = z
  .object({
    notifyReceived: z.boolean().optional(),
    notifySent: z.boolean().optional(),
    notifyWithdrawals: z.boolean().optional(),
    hideBalance: z.boolean().optional(),
  })
  .strict();

export async function PATCH(request: Request) {
  const user = await member();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const parsed = patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const out = await setWalletPrefs(user.id, parsed.data);
  if (!out.ok) return NextResponse.json({ error: "Couldn't save your wallet settings. Try again." }, { status: 503 });
  return NextResponse.json({ ok: true, prefs: out.prefs }, { headers: { "cache-control": "no-store" } });
}

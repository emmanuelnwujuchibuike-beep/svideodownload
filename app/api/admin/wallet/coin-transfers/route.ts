import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { adminCoinTransfers } from "@/lib/coin/admin-transfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/wallet/coin-transfers[?id=<transfer id>] — Frenz Coin Part 6: the recent coin transfers (or one), each
 * with its sender and recipient (public handle and name), amount, fee, total, the corrections already made (by whom,
 * why) and what is still correctable. Administrators only, read-only. A correction is POST …/[id]/correct.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (id !== null && !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "That isn't a transfer id." }, { status: 400 });
  const out = await adminCoinTransfers({ id, limit: 30 });
  if (!out.ok) return NextResponse.json({ error: out.reason === "pending_migration" ? "Coin transfers arrive with migration 0279." : "Couldn't load them." }, { status: 503 });
  return NextResponse.json({ items: out.items }, { headers: { "Cache-Control": "private, no-store" } });
}

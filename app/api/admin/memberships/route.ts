import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { reverseSub } from "@/lib/sub/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — SUB for admins: recent purchases with their price, fee and state, creator balances, and the financial audit log. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = createAdminClient();
  const [p, b, a] = await Promise.all([
    db.from("sub_purchases").select("id, creator_id, subscriber_id, price_cents, fee_cents, total_cents, charged_currency, charged_minor, reference, status, paid_at, reversed_at, created_at").order("created_at", { ascending: false }).limit(100),
    db.from("sub_balances").select("creator_id, pending_cents, available_cents, held_cents, debt_cents, lifetime_cents, withdrawn_cents").order("lifetime_cents", { ascending: false }).limit(50),
    db.from("financial_audit_log").select("id, actor_id, action, target_type, target_id, reference, details, created_at").order("created_at", { ascending: false }).limit(100),
  ]);
  if (p.error) return NextResponse.json({ purchases: [], balances: [], audit: [], ready: false });
  return NextResponse.json({ purchases: p.data ?? [], balances: b.data ?? [], audit: a.data ?? [], ready: true }, { headers: { "Cache-Control": "private, no-store" } });
}

const body = z.object({ reference: z.string().min(10).max(80), status: z.enum(["refunded", "disputed", "reversed"]), note: z.string().min(3).max(300) }).strict();

/** POST — reverse one SUB payment (refund, dispute or admin reversal). The access it bought ends; money already withdrawn becomes the creator's debt. Logged with the admin's id. */
export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give a reason of at least 3 characters." }, { status: 400 });
  const out = await reverseSub(parsed.data.reference, parsed.data.status, admin.id, parsed.data.note);
  console.info("[admin/sub] reversal", { admin: admin.id, reference: parsed.data.reference, ok: out.ok });
  return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error }, { status: out.status });
}

import { NextResponse } from "next/server";

import { aiJobReadLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/wallet/transfers — the member's last 30 transfers, sent and
 * received (0193), with who was on the other side. Two indexed reads in
 * parallel, one profile lookup. Never another member's email.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobReadLimiter.limit(`wallet-transfers:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const db = createAdminClient();
  const cols = "id, sender_id, recipient_id, amount, fee, note, created_at, credit_class";
  const [sent, received] = await Promise.all([
    db.from("credit_transfers").select(cols).eq("sender_id", user.id).order("created_at", { ascending: false }).limit(30),
    db.from("credit_transfers").select(cols).eq("recipient_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (sent.error && received.error) return NextResponse.json({ transfers: [] }, { headers: { "cache-control": "no-store" } });
  type Row = { id: string; sender_id: string; recipient_id: string; amount: number; fee: number; note: string | null; created_at: string; credit_class?: string | null };
  const rows = [...((sent.data ?? []) as Row[]), ...((received.data ?? []) as Row[])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30);
  const others = [...new Set(rows.map((r) => (r.sender_id === user.id ? r.recipient_id : r.sender_id)))];
  const names = new Map<string, string>();
  if (others.length) {
    const { data } = await db.from("profiles").select("id, handle, display_name").in("id", others);
    for (const p of (data ?? []) as { id: string; handle: string | null; display_name: string | null }[]) names.set(p.id, p.display_name || (p.handle ? `@${p.handle}` : "Frenz member"));
  }
  const transfers = rows.map((r) => {
    const out = r.sender_id === user.id;
    const other = out ? r.recipient_id : r.sender_id;
    return { id: r.id, direction: out ? "sent" : "received", amount: r.amount, fee: out ? r.fee : 0, with: names.get(other) ?? "Frenz member", note: r.note, at: r.created_at, kind: r.credit_class === "withdrawable" ? "withdrawable" : "usable" };
  });
  return NextResponse.json({ transfers }, { headers: { "cache-control": "no-store" } });
}

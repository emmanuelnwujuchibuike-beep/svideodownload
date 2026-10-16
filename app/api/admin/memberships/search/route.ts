import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { adminSearch } from "@/lib/sub/admin-reporting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?creator=&subscriber=&reference=&status=&from=&to=&cursor= — bounded search of subscription
 * purchases for admins (Part 7), 25 a page. No media access: reviewing exclusive content stays the
 * audited sub-review route.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const p = new URL(request.url).searchParams;
  const out = await adminSearch({ creator: p.get("creator"), subscriber: p.get("subscriber"), reference: p.get("reference"), status: p.get("status"), from: p.get("from"), to: p.get("to"), cursor: p.get("cursor") });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ items: out.items, next: out.next }, { headers: { "Cache-Control": "private, no-store" } });
}

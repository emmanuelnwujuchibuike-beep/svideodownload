import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { adminModeration } from "@/lib/sub/admin-reporting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?filter=open|removed|restored|dismissed&type=sub_post|sub_comment&cursor= — Exclusive
 * moderation by state for admins (Part 7), 25 a page. Actions stay POST /api/admin/moderation
 * (validated transitions, reason, audit log); reviewing media stays /api/admin/moderation/sub-review.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const p = new URL(request.url).searchParams;
  const out = await adminModeration(p.get("filter") ?? "open", p.get("type") ?? "sub_post", p.get("cursor"));
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ items: out.items, next: out.next }, { headers: { "Cache-Control": "private, no-store" } });
}

import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin/require-admin";
import { isSubTargetType, reviewSubTarget } from "@/lib/sub/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?type=sub_post|sub_comment&id= — an ADMIN reviews a reported exclusive post or comment
 * (Frenz Exclusive Part 2). Five-minute links to the private media, minted only after the
 * admin check; every review is written to the security audit log. Anyone else gets 404.
 */
export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id") ?? "";
  if (!isSubTargetType(type)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const out = await reviewSubTarget(gate.user.id, type, id);
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
  return out.ok ? NextResponse.json(out, { headers }) : NextResponse.json({ error: out.error }, { status: out.status, headers });
}

import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { repostRipple } from "@/lib/social/repost/history";
import { repostViewer } from "@/lib/social/repost/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/posts/:id/ripple — Social Ripple™: how this reel actually spread.
 *
 * Every node is a repost row and every edge is that row's recorded provenance.
 * The response is audience-filtered per viewer, so two people can legitimately
 * see different trees for the same post — a friends-only repost is a real part
 * of the spread for the people it reached and does not exist for anyone else.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  const viewer = await repostViewer(user?.id ?? null);
  const ripple = await repostRipple(id, viewer);
  if (!ripple) return NextResponse.json({ error: "Not available." }, { status: 404 });

  return NextResponse.json({ ripple });
}

import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { creatorRepostInsights, reposterReputation, repostInsights } from "@/lib/social/repost/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/posts/:id/repost/insights — what a repost of this post caused.
 *
 * Returns whichever of the two views the caller is entitled to, and both when
 * they are entitled to both (a creator who also reposted someone's reply):
 *
 *   · `mine`    — the viewer's own repost analytics, plus their private
 *                 Recommendation Circle™ score. Only ever their own row.
 *   · `creator` — repost analytics for a post the viewer PUBLISHED, built from
 *                 public reposts only.
 *
 * 🔴 There is no third view. Nothing here accepts another member's id, and
 * nothing returns who saw, opened or engaged with anything — reach is a number.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const [mine, creator, reputation] = await Promise.all([
    repostInsights(user.id, id),
    creatorRepostInsights(user.id, id),
    reposterReputation(user.id),
  ]);

  return NextResponse.json({
    mine,
    // `creatorRepostInsights` returns null when the post isn't theirs — no 403,
    // because a distinct error would answer "is this your post?" for any id.
    creator,
    reputation,
  });
}

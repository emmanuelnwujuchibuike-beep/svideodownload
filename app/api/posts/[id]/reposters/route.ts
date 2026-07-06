import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReposterRow {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  caption: string | null;
  repostedAt: string;
  isFollowing: boolean;
  isSelf: boolean;
}

/**
 * GET /api/posts/:id/reposters — who reposted this post, for the avatar-cluster
 * bottom sheet. People the viewer follows lead, then newest first. Public data
 * (reposts are public rows); the viewer only personalizes follow state.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const viewer = await getRequestUser(request);
  const db = createAdminClient();

  type Row = { user_id: string; caption?: string | null; created_at: string };
  let rows: Row[];
  const rich = await db
    .from("reposts")
    .select("user_id, caption, created_at")
    .eq("post_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (rich.error) {
    const plain = await db
      .from("reposts")
      .select("user_id, created_at")
      .eq("post_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (plain.error) return NextResponse.json({ reposters: [] });
    rows = (plain.data ?? []) as Row[];
  } else {
    rows = (rich.data ?? []) as Row[];
  }
  if (rows.length === 0) return NextResponse.json({ reposters: [] });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [{ data: profs }, follows] = await Promise.all([
    db.from("profiles").select("id, handle, display_name, avatar_url, is_verified").in("id", userIds),
    viewer
      ? db.from("follows").select("following_id").eq("follower_id", viewer.id).in("following_id", userIds)
      : Promise.resolve({ data: [] as { following_id: string }[] }),
  ]);
  const profById = new Map(
    ((profs ?? []) as { id: string; handle: string; display_name: string | null; avatar_url: string | null; is_verified: boolean | null }[]).map(
      (p) => [p.id, p],
    ),
  );
  const followedIds = new Set((((follows.data ?? []) as { following_id: string }[]) ?? []).map((f) => f.following_id));

  const reposters: ReposterRow[] = rows
    .map((r) => {
      const p = profById.get(r.user_id);
      if (!p) return null;
      return {
        id: p.id,
        handle: p.handle,
        displayName: p.display_name || p.handle,
        avatarUrl: p.avatar_url,
        isVerified: !!p.is_verified,
        caption: r.caption ?? null,
        repostedAt: r.created_at,
        isFollowing: followedIds.has(p.id),
        isSelf: viewer?.id === p.id,
      };
    })
    .filter((r): r is ReposterRow => r !== null)
    // People you follow first, then newest.
    .sort((a, b) => Number(b.isFollowing) - Number(a.isFollowing));

  return NextResponse.json({ reposters });
}

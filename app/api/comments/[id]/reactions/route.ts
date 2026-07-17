import { NextResponse } from "next/server";

import { flagsOf, isAccountVisibleTo, relationTo } from "@/lib/social/account-visibility";
import { friendIdSet } from "@/lib/social/friend-ids";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Reactor {
  emoji: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * GET /api/comments/:id/reactions — reaction insights: who reacted, with which
 * emoji. Powers the long-press "Reaction insights" glass card.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ reactors: [] }, { status: 400 });

  // Reads the viewer even though this endpoint is public: since 0082 an
  // admin-hidden account's reaction must still be visible to its FRIENDS, and
  // that can't be decided without knowing who's asking. Anonymous callers simply
  // resolve to a stranger, which hides every hidden reactor — fail closed.
  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anonymous — treated as a stranger below */
  }

  try {
    const db = createAdminClient();
    const rr = await db.from("comment_reactions").select("user_id, emoji").eq("comment_id", id).limit(200);
    const rows = ((rr.error
      ? (await db.from("comment_reactions").select("user_id").eq("comment_id", id).limit(200)).data
      : rr.data) as unknown as { user_id: string; emoji?: string }[] | null) ?? [];
    if (rows.length === 0) return NextResponse.json({ reactors: [] });

    const ids = [...new Set(rows.map((r) => r.user_id))];
    const { data: profs } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_suspended, is_hidden")
      .in("id", ids);
    const friends = await friendIdSet(viewerId);
    const byId = new Map<string, { handle: string; displayName: string; avatarUrl: string | null }>();
    for (const p of (profs ?? []) as Record<string, unknown>[]) {
      if (!p.handle) continue;
      if (!isAccountVisibleTo(flagsOf(p), relationTo(p.id as string, viewerId, friends))) continue;
      byId.set(p.id as string, {
        handle: p.handle as string,
        displayName: (p.display_name as string) || `@${p.handle as string}`,
        avatarUrl: (p.avatar_url as string) ?? null,
      });
    }
    const reactors: Reactor[] = [];
    for (const r of rows) {
      const card = byId.get(r.user_id);
      if (!card) continue;
      reactors.push({ emoji: r.emoji || "❤️", ...card });
    }
    return NextResponse.json({ reactors }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ reactors: [] });
  }
}

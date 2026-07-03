import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

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
      .select("id, handle, display_name, avatar_url, is_suspended")
      .in("id", ids);
    const byId = new Map<string, { handle: string; displayName: string; avatarUrl: string | null }>();
    for (const p of (profs ?? []) as Record<string, unknown>[]) {
      if ((p.is_suspended as boolean) || !p.handle) continue;
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

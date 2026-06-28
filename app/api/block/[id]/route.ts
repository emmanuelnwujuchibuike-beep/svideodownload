import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * POST /api/block/:id — block a user. Also removes any follow edges in BOTH
 * directions (a block severs the relationship). Done with the service role so
 * the other user's edge can be cleared too.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.id === id) return NextResponse.json({ error: "You can't block yourself." }, { status: 400 });

  try {
    const db = createAdminClient();
    await db.from("blocks").upsert(
      { blocker_id: user.id, blocked_id: id },
      { onConflict: "blocker_id,blocked_id" },
    );
    // Sever follows both ways (trigger keeps the counts correct).
    await db
      .from("follows")
      .delete()
      .or(
        `and(follower_id.eq.${user.id},following_id.eq.${id}),and(follower_id.eq.${id},following_id.eq.${user.id})`,
      );
    return NextResponse.json({ ok: true, blocked: true });
  } catch {
    return NextResponse.json({ error: "Couldn't block." }, { status: 500 });
  }
}

/** DELETE /api/block/:id — unblock a user. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  try {
    const db = createAdminClient();
    await db.from("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", id);
    return NextResponse.json({ ok: true, blocked: false });
  } catch {
    return NextResponse.json({ error: "Couldn't unblock." }, { status: 500 });
  }
}

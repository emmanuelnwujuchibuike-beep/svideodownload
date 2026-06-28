import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** POST /api/follow/:id — follow a user. RLS enforces self + block rules. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.id === id) return NextResponse.json({ error: "You can't follow yourself." }, { status: 400 });

  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: user.id, following_id: id });
  // Duplicate (already following) is a success no-op.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Couldn't follow (blocked or unavailable)." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, following: true });
}

/** DELETE /api/follow/:id — unfollow a user. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", user.id)
    .eq("following_id", id);
  if (error) return NextResponse.json({ error: "Couldn't unfollow." }, { status: 500 });
  return NextResponse.json({ ok: true, following: false });
}

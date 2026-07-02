import { NextResponse } from "next/server";

import { setFriendFavorite } from "@/lib/social/friends";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function toggle(on: boolean, params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const ok = await setFriendFavorite(user.id, id, on);
  if (!ok) return NextResponse.json({ error: "Couldn't update favorite." }, { status: 400 });
  return NextResponse.json({ ok: true, favorite: on });
}

/** POST /api/friends/:id/favorite — star a friend (private to you). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return toggle(true, params);
}

/** DELETE /api/friends/:id/favorite — remove the star. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return toggle(false, params);
}

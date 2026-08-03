import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/wallpapers/view — count one view of a wallpaper (migration 0108).
 *
 * Separate from `/engage` because engagement requires a session and a view does
 * NOT: the wallpaper library is public, and a signed-out visitor scrolling the
 * reels is exactly the traffic worth counting. There is nothing to authorise —
 * the only thing this endpoint can do is add one to one counter.
 *
 * The increment runs as a single atomic SQL statement (`increment_wallpaper_view`)
 * rather than a read-modify-write, so two people opening the same wallpaper at
 * the same moment count as two views, not one.
 *
 * De-duplication lives on the CLIENT, which only fires this once per wallpaper
 * per viewer session. That is deliberate: server-side per-visitor de-duplication
 * would mean storing a row per (visitor, wallpaper), which is a lot of writes
 * for a vanity metric. The number is therefore "views", not "unique viewers",
 * and is labelled as such.
 *
 * Always answers 200. A view that fails to count must never surface as an error
 * in front of someone looking at a picture.
 */
export async function POST(request: Request) {
  let id: string | undefined;
  try {
    ({ id } = (await request.json()) as { id?: string });
  } catch {
    return NextResponse.json({ ok: false });
  }
  // Built-in placeholders have no row; a non-uuid id is simply not counted.
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false });

  try {
    await createAdminClient().rpc("increment_wallpaper_view", { target: id });
  } catch {
    /* 0108 not applied yet, or a transient failure — never fail the viewer */
  }
  return NextResponse.json({ ok: true });
}

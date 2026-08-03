import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/wallpapers/engage — like / unlike / save / unsave a wallpaper.
 *
 * Signed-in only, and always as the caller: `user_id` comes from the session,
 * never from the body, so nobody can like on someone else's behalf. The row
 * counters are maintained by the 0105 triggers rather than written here, so a
 * double-tap can't inflate a count.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { id?: string; action?: string };
  try {
    body = (await request.json()) as { id?: string; action?: string };
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const id = body.id;
  const action = body.action;
  if (!id) return NextResponse.json({ error: "Missing wallpaper." }, { status: 400 });

  const admin = createAdminClient();
  try {
    switch (action) {
      case "like":
        // Idempotent: the composite primary key makes a repeat tap a no-op
        // rather than a duplicate row (and therefore not a second count).
        await admin.from("wallpaper_likes").upsert({ wallpaper_id: id, user_id: user.id }, { onConflict: "wallpaper_id,user_id", ignoreDuplicates: true });
        break;
      case "unlike":
        await admin.from("wallpaper_likes").delete().eq("wallpaper_id", id).eq("user_id", user.id);
        break;
      case "save":
        await admin.from("wallpaper_saves").upsert({ wallpaper_id: id, user_id: user.id }, { onConflict: "wallpaper_id,user_id", ignoreDuplicates: true });
        break;
      case "unsave":
        await admin.from("wallpaper_saves").delete().eq("wallpaper_id", id).eq("user_id", user.id);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

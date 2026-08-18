import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/privacy/muted-commenters — who the signed-in user has muted from
 *  commenting on their posts (see migration 0122 / mute-author route). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ muted: [] });

  try {
    const db = createAdminClient();
    const { data: rows, error } = await db
      .from("comment_muted_users")
      .select("muted_user_id, created_at")
      .eq("creator_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const ids = (rows ?? []).map((r) => r.muted_user_id as string);
    if (ids.length === 0) return NextResponse.json({ muted: [] });

    const { data: profs } = await db.from("profiles").select("id, handle, display_name, avatar_url").in("id", ids);
    const byId = new Map(((profs ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
    const muted = ids
      .map((id) => byId.get(id))
      .filter((p): p is Record<string, unknown> => !!p && !!p.handle)
      .map((p) => ({
        id: p.id as string,
        handle: p.handle as string,
        displayName: (p.display_name as string) || `@${p.handle as string}`,
        avatarUrl: (p.avatar_url as string | null) ?? null,
      }));
    return NextResponse.json({ muted });
  } catch {
    return NextResponse.json({ muted: [] });
  }
}

/** DELETE /api/privacy/muted-commenters?userId=… — unmute one person. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const userId = new URL(request.url).searchParams.get("userId") ?? "";
  if (!UUID.test(userId)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const { error } = await supabase.from("comment_muted_users").delete().eq("creator_id", user.id).eq("muted_user_id", userId);
  if (error) return NextResponse.json({ error: "Couldn't unmute." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

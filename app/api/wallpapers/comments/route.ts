import { NextResponse } from "next/server";

import { listWallpaperComments } from "@/lib/wallpapers-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/wallpapers/comments?id=… — a wallpaper's comments (public).
 * POST /api/wallpapers/comments      — add one (signed in, as yourself).
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ comments: [] });
  return NextResponse.json({ comments: await listWallpaperComments(id) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let payload: { id?: string; body?: string };
  try {
    payload = (await request.json()) as { id?: string; body?: string };
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const id = payload.id;
  const text = (payload.body ?? "").trim().slice(0, 500);
  if (!id || !text) return NextResponse.json({ error: "Nothing to post." }, { status: 400 });

  const admin = createAdminClient();
  try {
    const { data, error } = await admin
      .from("wallpaper_comments")
      .insert({ wallpaper_id: id, user_id: user.id, body: text })
      .select("id, body, created_at")
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed." }, { status: 500 });

    const { data: profile } = await admin
      .from("profiles")
      .select("handle, display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    return NextResponse.json({
      comment: {
        id: data.id as string,
        body: data.body as string,
        createdAt: data.created_at as string,
        authorHandle: (profile?.handle as string | null) ?? null,
        authorName: (profile?.display_name as string | null) ?? null,
        authorAvatar: (profile?.avatar_url as string | null) ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}

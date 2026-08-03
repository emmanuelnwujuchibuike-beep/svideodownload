import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin: adjust a user's follower count, or a post's likes / views (owner). The
 * counters are trigger-INCREMENTED (not recomputed), so an absolute value set here
 * persists — real follows/likes/views apply their deltas on top afterwards. This is
 * a deliberate admin override tool, not systemic fabrication; every change is an
 * explicit admin action.
 */
const MAX = 1_000_000_000;

export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle");
  const postId = url.searchParams.get("postId");
  const db = createAdminClient();
  if (handle) {
    const { data } = await db.from("profiles").select("id, handle, display_name, followers_count").eq("handle", handle.replace(/^@/, "").trim()).maybeSingle();
    if (!data) return NextResponse.json({ error: "No user with that handle." }, { status: 404 });
    return NextResponse.json({ type: "profile", ...data });
  }
  if (postId) {
    const { data } = await db.from("posts").select("id, title, likes_count, views_count").eq("id", postId).maybeSingle();
    if (!data) return NextResponse.json({ error: "No post with that id." }, { status: 404 });
    return NextResponse.json({ type: "post", ...data });
  }
  return NextResponse.json({ error: "Provide a handle or a postId." }, { status: 400 });
}

const profileSchema = z.object({ type: z.literal("profile"), handle: z.string().min(1), followers: z.number().int().min(0).max(MAX) });
const postSchema = z.object({
  type: z.literal("post"),
  postId: z.string().uuid(),
  likes: z.number().int().min(0).max(MAX).optional(),
  views: z.number().int().min(0).max(MAX).optional(),
});

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const db = createAdminClient();

  const asProfile = profileSchema.safeParse(body);
  if (asProfile.success) {
    const handle = asProfile.data.handle.replace(/^@/, "").trim();
    const { data, error } = await db.from("profiles").update({ followers_count: asProfile.data.followers }).eq("handle", handle).select("id").maybeSingle();
    if (error) return NextResponse.json({ error: "Couldn't update the user." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "No user with that handle." }, { status: 404 });
    return NextResponse.json({ ok: true, followers: asProfile.data.followers });
  }

  const asPost = postSchema.safeParse(body);
  if (asPost.success) {
    const patch: Record<string, number> = {};
    if (typeof asPost.data.likes === "number") patch.likes_count = asPost.data.likes;
    if (typeof asPost.data.views === "number") patch.views_count = asPost.data.views;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    const { error } = await db.from("posts").update(patch).eq("id", asPost.data.postId);
    if (error) return NextResponse.json({ error: "Couldn't update the post." }, { status: 500 });
    return NextResponse.json({ ok: true, ...patch });
  }

  return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
}

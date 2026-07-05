import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { pushSocialEvent } from "@/lib/push/social-push";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function repostCount(db: ReturnType<typeof createAdminClient>, id: string): Promise<number> {
  try {
    const { data } = await db.from("posts").select("reposts_count").eq("id", id).maybeSingle();
    return (data?.reposts_count as number | null) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * POST /api/posts/:id/repost — repost a public post to your profile/feed.
 * DELETE — undo the repost. A repost is a pointer (attribution preserved); it
 * never copies the media. Accepts a bearer token (native) or the cookie session.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to repost." }, { status: 401 });

  const db = createAdminClient();
  const { data: post } = await db
    .from("posts")
    .select("publisher_id, visibility, status")
    .eq("id", id)
    .maybeSingle();
  if (!post) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (post.status !== "published" || post.visibility !== "public") {
    return NextResponse.json({ error: "This post can't be reposted." }, { status: 403 });
  }
  if (post.publisher_id === user.id) return NextResponse.json({ error: "You can't repost your own post." }, { status: 400 });

  const { error } = await db.from("reposts").insert({ user_id: user.id, post_id: id });
  if (error) {
    if (error.code === "23505") {
      // Already reposted → idempotent success.
      return NextResponse.json({ ok: true, reposted: true, count: await repostCount(db, id) });
    }
    if (error.code === "42P01") {
      return NextResponse.json({ error: "Reposts aren't enabled yet." }, { status: 503 });
    }
    return NextResponse.json({ error: "Couldn't repost." }, { status: 500 });
  }
  // Device push (the in-app notification row is created by the DB trigger).
  void pushSocialEvent({ actorId: user.id, type: "repost", postId: id });
  return NextResponse.json({ ok: true, reposted: true, count: await repostCount(db, id) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const db = createAdminClient();
  try {
    await db.from("reposts").delete().eq("user_id", user.id).eq("post_id", id);
  } catch {
    /* table not migrated — treat as already-not-reposted */
  }
  return NextResponse.json({ ok: true, reposted: false, count: await repostCount(db, id) });
}

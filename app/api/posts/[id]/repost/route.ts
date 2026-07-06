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

const CAPTION_MAX = 300;

/** Normalize a caption: trim, collapse blank → null, enforce the 300 limit. */
function cleanCaption(raw: unknown): { ok: true; caption: string | null } | { ok: false } {
  if (raw == null) return { ok: true, caption: null };
  if (typeof raw !== "string") return { ok: false };
  const caption = raw.replace(/\r\n/g, "\n").trim();
  if (caption.length === 0) return { ok: true, caption: null };
  if (caption.length > CAPTION_MAX) return { ok: false };
  return { ok: true, caption };
}

/**
 * POST /api/posts/:id/repost — repost a public post to your profile/feed, with
 * an optional recommendation caption ("why I'm recommending this") that belongs
 * to the reposter and never touches the original.
 * PATCH — edit the caption (15-minute grace window) or pin/unpin the repost.
 * DELETE — undo the repost. A repost is a pointer (attribution preserved); it
 * never copies the media. Accepts a bearer token (native) or the cookie session.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to repost." }, { status: 401 });

  let captionRaw: unknown = null;
  try {
    ({ caption: captionRaw } = (await request.json()) as { caption?: unknown });
  } catch {
    /* no body — quick repost */
  }
  const cleaned = cleanCaption(captionRaw);
  if (!cleaned.ok) return NextResponse.json({ error: `Captions are up to ${CAPTION_MAX} characters.` }, { status: 400 });

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

  const { error } = await db.from("reposts").insert({ user_id: user.id, post_id: id, caption: cleaned.caption });
  if (error) {
    if (error.code === "23505") {
      // Already reposted → idempotent success.
      return NextResponse.json({ ok: true, reposted: true, count: await repostCount(db, id) });
    }
    if (error.code === "42P01") {
      return NextResponse.json({ error: "Reposts aren't enabled yet." }, { status: 503 });
    }
    if (error.code === "42703") {
      // Caption column not migrated yet (0030) — fall back to a plain repost.
      const { error: bare } = await db.from("reposts").insert({ user_id: user.id, post_id: id });
      if (!bare || bare.code === "23505") {
        return NextResponse.json({ ok: true, reposted: true, count: await repostCount(db, id) });
      }
      return NextResponse.json({ error: "Couldn't repost." }, { status: 500 });
    }
    return NextResponse.json({ error: "Couldn't repost." }, { status: 500 });
  }
  // Device push (the in-app notification row is created by the DB trigger).
  void pushSocialEvent({ actorId: user.id, type: "repost", postId: id });
  return NextResponse.json({ ok: true, reposted: true, count: await repostCount(db, id) });
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: { caption?: unknown; pinned?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: row } = await db
    .from("reposts")
    .select("id, created_at, caption, pinned_at")
    .eq("user_id", user.id)
    .eq("post_id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "You haven't reposted this." }, { status: 404 });

  const patch: Record<string, unknown> = {};

  if ("caption" in body) {
    const cleaned = cleanCaption(body.caption);
    if (!cleaned.ok) return NextResponse.json({ error: `Captions are up to ${CAPTION_MAX} characters.` }, { status: 400 });
    const age = Date.now() - new Date(row.created_at as string).getTime();
    if (age > EDIT_WINDOW_MS) {
      return NextResponse.json({ error: "Captions can only be edited within 15 minutes." }, { status: 403 });
    }
    if (cleaned.caption !== (row.caption ?? null)) {
      patch.caption = cleaned.caption;
      patch.edited_at = new Date().toISOString();
    }
  }

  if ("pinned" in body) {
    patch.pinned_at = body.pinned ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { error } = await db.from("reposts").update(patch).eq("id", row.id);
  if (error) return NextResponse.json({ error: "Couldn't update the repost." }, { status: 500 });
  return NextResponse.json({ ok: true });
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

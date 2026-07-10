import { NextResponse } from "next/server";
import { z } from "zod";

import { pushSocialEvent } from "@/lib/push/social-push";
import { assistantLimiter } from "@/lib/rate-limit";
import { isCommentMood } from "@/lib/social/comment-meta";
import { canComment, commentSpamReason, listComments } from "@/lib/social/engagement";
import { isStickerId } from "@/lib/social/stickers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/posts/:id/comments — threaded comments for the in-feed viewer. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anon */
  }

  const { data: post } = await createAdminClient()
    .from("posts")
    .select("publisher_id")
    .eq("id", id)
    .maybeSingle();
  if (!post) return NextResponse.json({ comments: [] });

  const comments = await listComments(id, post.publisher_id as string, viewerId);
  const gate = viewerId ? await canComment(id, viewerId) : { ok: false as const, reason: "unavailable" as const };
  return NextResponse.json(
    { comments, canComment: gate.ok, loggedIn: !!viewerId },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
const schema = z.object({
  body: z.string().trim().max(1000).optional().default(""),
  sticker: z.string().max(40).nullable().optional(),
  imageUrl: z.string().url().max(2048).nullable().optional(),
  mood: z.string().max(20).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const GATE_MSG: Record<string, string> = {
  off: "Comments are turned off for this post.",
  followers: "Only the creator's followers can comment.",
  blocked: "You can't comment here.",
  unavailable: "This post isn't available.",
};

/** POST /api/posts/:id/comments — add a comment (policy + anti-spam gated). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  // Trust/account gate.
  const { data: prof } = await supabase
    .from("profiles")
    .select("is_suspended")
    .eq("id", user.id)
    .maybeSingle();
  if (prof?.is_suspended) return NextResponse.json({ error: "Your account can't comment." }, { status: 403 });

  const { success } = await assistantLimiter.limit(`comment:${user.id}`);
  if (!success) return NextResponse.json({ error: "You're commenting too fast." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Write a comment first." }, { status: 400 });

  const body = parsed.data.body.trim();
  const sticker = parsed.data.sticker && isStickerId(parsed.data.sticker) ? parsed.data.sticker : null;
  const imageUrl = parsed.data.imageUrl ?? null;
  const mood = parsed.data.mood && isCommentMood(parsed.data.mood) ? parsed.data.mood : null;
  if (!body && !sticker && !imageUrl) {
    return NextResponse.json({ error: "Add a comment, sticker, or picture." }, { status: 400 });
  }

  if (body) {
    const spam = commentSpamReason(body);
    if (spam) return NextResponse.json({ error: spam }, { status: 400 });
  }

  const gate = await canComment(id, user.id);
  if (!gate.ok) return NextResponse.json({ error: GATE_MSG[gate.reason] }, { status: 403 });

  // Keep threads exactly one level deep: a reply to a reply attaches to the
  // top-level parent. Ignore parents that aren't on this post. The composer
  // UI never shows a Reply button below depth 0, so in practice `parentId`
  // always already IS the top-level comment — `replyTargetAuthorId` is
  // captured before any reassignment below so push notifies whoever was
  // actually replied to, not whatever the (normally no-op) flatten resolves to.
  let parentId = parsed.data.parentId ?? null;
  let replyTargetAuthorId: string | null = null;
  if (parentId) {
    const { data: parent } = await supabase
      .from("post_comments")
      .select("post_id, parent_id, author_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!parent || parent.post_id !== id) {
      parentId = null;
    } else {
      replyTargetAuthorId = parent.author_id as string;
      if (parent.parent_id) parentId = parent.parent_id as string;
    }
  }

  // Only send the rich columns when they carry a value, so a plain-text comment
  // still inserts cleanly even if the sticker/image migration hasn't run yet.
  const insert: Record<string, unknown> = {
    post_id: id,
    author_id: user.id,
    parent_id: parentId,
    body,
  };
  if (sticker) insert.sticker = sticker;
  if (imageUrl) insert.image_url = imageUrl;
  if (mood) insert.mood = mood;

  const { data, error } = await supabase.from("post_comments").insert(insert).select("id").single();
  if (error) {
    const msg =
      (sticker || imageUrl || mood) && /column|schema/i.test(error.message ?? "")
        ? "Some comment features aren't enabled yet."
        : "Couldn't post comment.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  // Device push — to the parent comment's author for a reply, or the post
  // owner for a top-level comment (either way, skipped when it'd just be
  // pushing your own action back to you — pushSocialEvent's own guard).
  if (parentId && replyTargetAuthorId) {
    void pushSocialEvent({ actorId: user.id, type: "reply", postId: id, recipientId: replyTargetAuthorId });
  } else {
    void pushSocialEvent({ actorId: user.id, type: "comment", postId: id });
  }
  return NextResponse.json({ ok: true, id: data.id });
}

import { after, NextResponse } from "next/server";
import { z } from "zod";

import { pushSocialEvent } from "@/lib/push/social-push";
import { assistantLimiter } from "@/lib/rate-limit";
import { isCommentMood } from "@/lib/social/comment-meta";
import { canComment, commentKeywordBlocked, commentSpamReason, listComments } from "@/lib/social/engagement";
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
  /*
    🔴 THE SAME SHAPE ON EVERY PATH.

    This used to return a bare `{ comments: [] }` when the post was missing —
    no `canComment`, no `loggedIn`. The client treats any non-null body as a
    successful load (`if (data) setComments(data)`), so it then rendered the
    comments UI with `undefined` where two booleans were required, and every
    consumer downstream had to survive a shape the type said was impossible.

    A partial payload is worse than an error here: it type-checks at the call
    site (the cast in `loadPostComments<CommentsData>` asserts the full shape)
    and only fails at runtime, deep inside whichever child dereferences it
    first. Returning the complete, honest shape means "no post" renders as an
    empty comments list instead of a half-initialised one.
  */
  if (!post) return NextResponse.json({ comments: [], canComment: false, loggedIn: !!viewerId });

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
  voiceUrl: z.string().url().max(2048).nullable().optional(),
  // A little over VOICE_MAX_MS/VIDEO_MAX_MS (lib/media/comment-recording.ts)
  // to allow for clock drift between the recorder's own stop and this write
  // — the recorder itself is what actually enforces the cap.
  voiceDurationMs: z.number().int().min(0).max(200_000).nullable().optional(),
  voiceWaveform: z.array(z.number().int().min(0).max(100)).max(200).nullable().optional(),
  videoUrl: z.string().url().max(2048).nullable().optional(),
  videoDurationMs: z.number().int().min(0).max(80_000).nullable().optional(),
  videoThumbnailUrl: z.string().url().max(2048).nullable().optional(),
  // Part 5 tranche 4.
  quotedCommentId: z.string().uuid().nullable().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
  locationLabel: z.string().trim().max(200).nullable().optional(),
});

const GATE_MSG: Record<string, string> = {
  off: "Comments are turned off for this post.",
  followers: "Only the creator's followers can comment.",
  blocked: "You can't comment here.",
  muted: "The creator has muted you from commenting.",
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

  // Trust/account gate. Checks `is_suspended` ONLY, on purpose: a hidden account
  // (`is_hidden`, migration 0082) keeps every ability and must still be able to
  // comment — its reach is limited by who can SEE it, not by blocking the act.
  // Don't add is_hidden here; that would cut it off from its own friends.
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
  const voiceUrl = parsed.data.voiceUrl ?? null;
  const videoUrl = parsed.data.videoUrl ?? null;
  const hasLocation = parsed.data.locationLat != null && parsed.data.locationLng != null;
  if (!body && !sticker && !imageUrl && !voiceUrl && !videoUrl && !hasLocation) {
    return NextResponse.json({ error: "Add a comment, sticker, picture, voice note, video, or location." }, { status: 400 });
  }

  if (body) {
    const spam = commentSpamReason(body);
    if (spam) return NextResponse.json({ error: spam }, { status: 400 });
  }

  const gate = await canComment(id, user.id);
  if (!gate.ok) return NextResponse.json({ error: GATE_MSG[gate.reason] }, { status: 403 });

  // Keyword filter (Part 5 tranche 4) — the publisher's own muted-words list.
  // Only meaningful when the comment carries actual text.
  if (body) {
    const { data: postRow } = await supabase.from("posts").select("publisher_id").eq("id", id).maybeSingle();
    const publisherId = postRow?.publisher_id as string | undefined;
    if (publisherId && (await commentKeywordBlocked(publisherId, body))) {
      // Deliberately doesn't name the matched word — a specific error would
      // hand a spammer a one-word-at-a-time way to probe the filter list.
      return NextResponse.json({ error: "Your comment couldn't be posted — it may contain a filtered word." }, { status: 400 });
    }
  }

  // Part 5 tranche 2: real arbitrary-depth threading — a reply to a reply
  // attaches to the comment actually being replied to, not flattened to the
  // top-level parent (the prior "exactly one level deep" behavior). Ignore
  // parents that aren't on this post. `replyTargetAuthorId` notifies whoever
  // was actually replied to, at any depth.
  let parentId = parsed.data.parentId ?? null;
  let replyTargetAuthorId: string | null = null;
  if (parentId) {
    const { data: parent } = await supabase
      .from("post_comments")
      .select("post_id, author_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!parent || parent.post_id !== id) {
      parentId = null;
    } else {
      replyTargetAuthorId = parent.author_id as string;
    }
  }

  // Quote Reply (Part 5 tranche 4) — validated the same way parentId is:
  // must be a real comment on THIS post, or it's silently dropped rather
  // than trusted from the client (a hand-rolled request can't make a
  // comment appear to quote something from a different post).
  let quotedCommentId = parsed.data.quotedCommentId ?? null;
  if (quotedCommentId) {
    const { data: quoted } = await supabase.from("post_comments").select("post_id").eq("id", quotedCommentId).maybeSingle();
    if (!quoted || quoted.post_id !== id) quotedCommentId = null;
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
  if (voiceUrl) {
    insert.voice_url = voiceUrl;
    insert.voice_duration_ms = parsed.data.voiceDurationMs ?? null;
    insert.voice_waveform = parsed.data.voiceWaveform ?? null;
  }
  if (videoUrl) {
    insert.video_url = videoUrl;
    insert.video_duration_ms = parsed.data.videoDurationMs ?? null;
    insert.video_thumbnail_url = parsed.data.videoThumbnailUrl ?? null;
  }
  if (quotedCommentId) insert.quoted_comment_id = quotedCommentId;
  if (hasLocation) {
    insert.location_lat = parsed.data.locationLat;
    insert.location_lng = parsed.data.locationLng;
    insert.location_label = parsed.data.locationLabel ?? null;
  }

  const { data, error } = await supabase.from("post_comments").insert(insert).select("id").single();
  if (error) {
    const msg =
      (sticker || imageUrl || mood || voiceUrl || videoUrl || quotedCommentId || hasLocation) && /column|schema/i.test(error.message ?? "")
        ? "Some comment features aren't enabled yet."
        : "Couldn't post comment.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  // Device push — to the parent comment's author for a reply, or the post
  // owner for a top-level comment (either way, skipped when it'd just be
  // pushing your own action back to you — pushSocialEvent's own guard).
  // after(), not bare void — see lib/social/messages.ts's sendMessage() for why.
  if (parentId && replyTargetAuthorId) {
    after(() => pushSocialEvent({ actorId: user.id, type: "reply", postId: id, recipientId: replyTargetAuthorId }));
  } else {
    after(() => pushSocialEvent({ actorId: user.id, type: "comment", postId: id }));
  }
  return NextResponse.json({ ok: true, id: data.id });
}

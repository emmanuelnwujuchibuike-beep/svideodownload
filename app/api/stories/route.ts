import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveStories, type StoryScope } from "@/lib/social/stories";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/stories?scope=all|friends|following — active stories grouped by author. */
export async function GET(request: Request) {
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
  const raw = new URL(request.url).searchParams.get("scope");
  const scope: StoryScope = raw === "friends" || raw === "following" ? raw : "all";
  const groups = await getActiveStories(viewerId, 24, scope);
  return NextResponse.json({ groups }, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z.object({
  mediaUrl: z.string().url().max(2048),
  mediaKind: z.enum(["image", "video"]),
  caption: z.string().trim().max(300).optional(),
  /** Cover image captured from the first frame of a video upload. */
  thumbnailUrl: z.string().url().max(2048).optional(),
  /** Where the upload goes: a public post on your profile, a 24h story, or both. */
  destination: z.enum(["post", "story", "both"]).optional(),
  // Legacy flag from the old story-only composer.
  shareReel: z.boolean().optional(),
});

/**
 * POST /api/stories — create content from an upload. Depending on `destination`
 * it publishes a public post (photo or video) on the user's profile/feed, a 24h
 * story, or both. Kept here (not /api/posts) because it shares the upload path.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  const { mediaUrl, mediaKind, caption, thumbnailUrl } = parsed.data;
  // Every post carries a cover: the image itself, or the captured video frame.
  const cover = mediaKind === "image" ? mediaUrl : (thumbnailUrl ?? null);
  const destination = parsed.data.destination ?? (parsed.data.shareReel ? "both" : "post");
  const wantStory = destination === "story" || destination === "both";
  const wantPost = destination === "post" || destination === "both";

  let storyId: string | null = null;
  if (wantStory) {
    const { data: story, error } = await supabase
      .from("stories")
      .insert({ user_id: user.id, media_url: mediaUrl, media_kind: mediaKind, caption: caption ?? null })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: "Couldn't post story." }, { status: 500 });
    storyId = story.id as string;
  }

  // Publish a public post backed by the upload (photo or video).
  let postId: string | null = null;
  if (wantPost) {
    const admin = createAdminClient();
    const { data: prof } = await admin.from("profiles").select("handle, is_suspended").eq("id", user.id).maybeSingle();
    if (prof?.handle && !prof.is_suspended) {
      const hash = createHash("sha256").update(mediaUrl).digest("hex");
      const { data: post } = await admin
        .from("posts")
        .insert({
          publisher_id: user.id,
          source_url: mediaUrl,
          source_url_hash: hash,
          platform: "frenz",
          media_kind: mediaKind,
          // No caption → store an empty title (the feed/reel simply shows no
          // caption). Never invent an automatic "My video"/"My photo".
          title: (caption ?? "").slice(0, 300),
          media_url: mediaUrl,
          thumbnail_url: cover,
          visibility: "public",
          status: "published",
        })
        .select("id")
        .maybeSingle();
      postId = (post?.id as string) ?? null;
    } else if (!wantStory) {
      return NextResponse.json({ error: "Finish setting up your profile to post." }, { status: 403 });
    }
  }

  return NextResponse.json({ ok: true, storyId, postId });
}

import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { bustHomeFeedCache } from "@/lib/social/home-feed";
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

const mediaItem = z.object({
  url: z.string().url().max(2048),
  kind: z.enum(["image", "video"]),
  thumbnailUrl: z.string().url().max(2048).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});

const schema = z.object({
  mediaUrl: z.string().url().max(2048),
  mediaKind: z.enum(["image", "video"]),
  caption: z.string().trim().max(300).optional(),
  /** Cover image captured from the first frame of a video upload. */
  thumbnailUrl: z.string().url().max(2048).optional(),
  /** Where the upload goes: the Feed, the Reels product, a 24h story, or feed+story.
      Feed and Reels are separate — nothing appears in both unless published twice. */
  destination: z.enum(["post", "reel", "story", "both"]).optional(),
  /**
   * Carousel/album: the full ORDERED media list (item 0 = the cover; mediaUrl/
   * mediaKind must match it). Destination rules: photos → feed; multi-video →
   * feed or reels (a reel album); MIXED photos+videos → feed only.
   */
  media: z.array(mediaItem).min(2).max(20).optional(),
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
  const wantPost = destination === "post" || destination === "both" || destination === "reel";
  // Explicit product choice: a Reel lives ONLY in Reels; a post lives ONLY in the feed.
  // Album rule: a MIXED photos+videos album can never be a Reel — it publishes
  // to the feed regardless of what the client asked for.
  const media = parsed.data.media;
  const mixedAlbum = !!media && media.some((m) => m.kind === "image") && media.some((m) => m.kind === "video");
  const format = destination === "reel" && !mixedAlbum ? "reel" : "feed";

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
      const base = {
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
      };
      // `format` column arrives with migration 0031 — plain insert until then.
      const first = await admin.from("posts").insert({ ...base, format }).select("id").maybeSingle();
      let post = first.data;
      if (first.error?.code === "42703") {
        ({ data: post } = await admin.from("posts").insert(base).select("id").maybeSingle());
      }
      postId = (post?.id as string) ?? null;

      // Album items (carousel / reel album) — ordered rows in post_media
      // (migration 0032; silently skipped until it's applied). The post's own
      // media stays item 0, so nothing breaks for single-media readers.
      if (postId && media && media.length > 1) {
        await admin
          .from("post_media")
          .insert(
            media.map((m, idx) => ({
              post_id: postId,
              idx,
              media_kind: m.kind,
              media_url: m.url,
              thumbnail_url: m.thumbnailUrl ?? null,
              media_width: m.width ?? null,
              media_height: m.height ?? null,
            })),
          )
          .then(
            (r) => r,
            () => null,
          );
      }
    } else if (!wantStory) {
      return NextResponse.json({ error: "Finish setting up your profile to post." }, { status: 403 });
    }
  }

  // The publisher's own feed caches are busted so the new post/reel shows up
  // the moment their feed re-renders — never "where did my upload go?".
  if (postId) await bustHomeFeedCache(user.id);

  return NextResponse.json({ ok: true, storyId, postId });
}

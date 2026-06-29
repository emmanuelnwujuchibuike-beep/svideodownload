import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveStories } from "@/lib/social/stories";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/stories — active (non-expired) stories grouped by author. */
export async function GET() {
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
  const groups = await getActiveStories(viewerId, 24);
  return NextResponse.json({ groups }, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z.object({
  mediaUrl: z.string().url().max(2048),
  mediaKind: z.enum(["image", "video"]),
  caption: z.string().trim().max(300).optional(),
  shareReel: z.boolean().optional(),
});

/** POST /api/stories — create a 24h story; videos can also post as a Reel. */
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid story." }, { status: 400 });
  const { mediaUrl, mediaKind, caption, shareReel } = parsed.data;

  // Create the story (RLS: owner insert).
  const { data: story, error } = await supabase
    .from("stories")
    .insert({ user_id: user.id, media_url: mediaUrl, media_kind: mediaKind, caption: caption ?? null })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: "Couldn't post story." }, { status: 500 });

  // Videos auto-publish as a Reel (a normal public post backed by the upload).
  let postId: string | null = null;
  if (shareReel && mediaKind === "video") {
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
          media_kind: "video",
          title: (caption ?? "My reel").slice(0, 300),
          media_url: mediaUrl,
          thumbnail_url: null,
          visibility: "public",
          status: "published",
        })
        .select("id")
        .maybeSingle();
      postId = (post?.id as string) ?? null;
    }
  }

  return NextResponse.json({ ok: true, storyId: story.id, postId });
}

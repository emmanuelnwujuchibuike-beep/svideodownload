import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/posts/:id/repost — repost a public post to your own profile/feed.
 * Creates a new post you own that carries the original media, credited to the
 * original creator in the caption. Collision-safe hash so the same post can be
 * reposted by different people (but only once each).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  // Accepts a bearer token (native) or the cookie session (web).
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to repost." }, { status: 401 });

  const admin = createAdminClient();
  const { data: src } = await admin
    .from("posts")
    .select("id, publisher_id, media_url, media_kind, title, thumbnail_url, stream_uid, category, visibility, status")
    .eq("id", id)
    .maybeSingle();
  if (!src || !src.media_url) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (src.status !== "published" || src.visibility !== "public") {
    return NextResponse.json({ error: "This post can't be reposted." }, { status: 403 });
  }
  if (src.publisher_id === user.id) return NextResponse.json({ error: "You can't repost your own post." }, { status: 400 });

  // Ensure the reposter has a usable profile.
  const { data: prof } = await admin.from("profiles").select("handle, is_suspended").eq("id", user.id).maybeSingle();
  if (!prof?.handle || prof.is_suspended) return NextResponse.json({ error: "Finish setting up your profile first." }, { status: 403 });

  const { data: origProf } = await admin.from("profiles").select("handle").eq("id", src.publisher_id).maybeSingle();
  const credit = origProf?.handle ? `Reposted from @${origProf.handle}` : "Reposted";

  // Unique per (reposter, original) so a repost can't be duplicated but different
  // people can each repost.
  const hash = createHash("sha256").update(`repost:${user.id}:${id}`).digest("hex");

  const { data: post, error } = await admin
    .from("posts")
    .insert({
      publisher_id: user.id,
      source_url: src.media_url,
      source_url_hash: hash,
      platform: "frenz",
      media_kind: src.media_kind,
      title: src.title || "",
      description: credit,
      category: src.category ?? null,
      media_url: src.media_url,
      thumbnail_url: src.thumbnail_url,
      stream_uid: src.stream_uid ?? null,
      visibility: "public",
      status: "published",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Duplicate → they already reposted it.
    if (error.code === "23505") return NextResponse.json({ error: "You already reposted this." }, { status: 409 });
    return NextResponse.json({ error: "Couldn't repost." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: post?.id ?? null });
}

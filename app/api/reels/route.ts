import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getHomeFeed, type HomeFeedSort } from "@/lib/social/home-feed";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS: HomeFeedSort[] = ["for_you", "following", "recent"];

/**
 * GET /api/reels?sort=&offset=&limit= — the Reels product's OWN paginated
 * feed: exclusively `format = 'reel'` posts (never text/photo feed content),
 * with its own cache keys. Same envelope as /api/home-feed so the deck client
 * is shared.
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const sortParam = sp.get("sort") as HomeFeedSort | null;
  const sort: HomeFeedSort = sortParam && SORTS.includes(sortParam) ? sortParam : "for_you";
  const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
  const limit = Math.min(24, Math.max(1, Number(sp.get("limit") ?? 12) || 12));

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

  const page = await getHomeFeed({ viewerId, sort, offset, limit, format: "reel" });
  const cacheControl = viewerId
    ? "private, max-age=15, stale-while-revalidate=60"
    : "public, s-maxage=20, stale-while-revalidate=90";
  return NextResponse.json(page, { headers: { "Cache-Control": cacheControl } });
}

const schema = z.object({
  mediaUrl: z.string().url().max(2048),
  mediaKind: z.enum(["video", "audio", "image"]).default("video"),
  title: z.string().trim().min(1).max(300),
  thumbnailUrl: z.string().url().max(2048).nullable().optional(),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
});

/**
 * POST /api/reels — publish an uploaded/downloaded media file as a public post
 * (Reel) backed by a stored `media_url`, so anyone — free users included — can
 * watch it online in-app without downloading or visiting the source platform.
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid post." }, { status: 400 });
  const { mediaUrl, mediaKind, title, thumbnailUrl, sourceUrl } = parsed.data;

  const admin = createAdminClient();
  const { data: prof } = await admin.from("profiles").select("handle, is_suspended").eq("id", user.id).maybeSingle();
  if (!prof?.handle) return NextResponse.json({ error: "Set a username before publishing." }, { status: 403 });
  if (prof.is_suspended) return NextResponse.json({ error: "Your account can't publish." }, { status: 403 });

  const src = sourceUrl ?? mediaUrl;
  const hash = createHash("sha256").update(mediaUrl).digest("hex");
  const base = {
    publisher_id: user.id,
    source_url: src,
    source_url_hash: hash,
    platform: "frenz",
    media_kind: mediaKind,
    title: title.slice(0, 300),
    media_url: mediaUrl,
    thumbnail_url: thumbnailUrl ?? null,
    visibility: "public",
    status: "published",
  };
  // Published through the Reels product → stamped as a reel (column arrives
  // with migration 0031; fall back to a plain insert until it's applied).
  let { data, error } = await admin.from("posts").insert({ ...base, format: "reel" }).select("id").maybeSingle();
  if (error?.code === "42703") {
    ({ data, error } = await admin.from("posts").insert(base).select("id").maybeSingle());
  }

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "You've already published this." }, { status: 409 });
    return NextResponse.json({ error: "Couldn't publish." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, postId: data?.id ?? null });
}

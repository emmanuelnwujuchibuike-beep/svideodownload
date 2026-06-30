import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const { data, error } = await admin
    .from("posts")
    .insert({
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
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "You've already published this." }, { status: 409 });
    return NextResponse.json({ error: "Couldn't publish." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, postId: data?.id ?? null });
}

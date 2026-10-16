import { NextResponse } from "next/server";

import { deleteSubPost, openSubPost } from "@/lib/sub/posts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * GET — open one subscriber-only post: an active subscription is checked on EVERY
 * request, then five-minute links are minted. No store, no share link, no embed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const out = await openSubPost(id, user?.id ?? null);
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
  return out.ok ? NextResponse.json(out, { headers }) : NextResponse.json({ error: out.error }, { status: out.status, headers });
}

/** DELETE — the creator removes their own post and its private files. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const out = await deleteSubPost(user.id, id);
  return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error }, { status: out.status });
}

/**
 * PATCH — the CREATOR's browser saves a missing preview for one of their own posts (0237): a
 * video posted before the composer made previews has none, and only a browser can draw its first
 * frame (no ffmpeg on Vercel, nothing on the worker). The key must be in the creator's own private
 * folder; only an empty thumb_key is ever filled. The size is saved too when it was unknown.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { idx?: unknown; thumbKey?: unknown; width?: unknown; height?: unknown; audience?: unknown } | null;
  // Part 3 (0248): the creator switches a post between locked and hidden — only their own post
  if (body && "audience" in body) {
    const { setSubPostAudience } = await import("@/lib/sub/posts");
    const out = await setSubPostAudience(user.id, id, body.audience);
    return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error }, { status: out.status });
  }
  const idx = typeof body?.idx === "number" && Number.isInteger(body.idx) && body.idx >= 0 && body.idx < 10 ? body.idx : null;
  const key = typeof body?.thumbKey === "string" ? body.thumbKey : "";
  if (idx === null || !key.startsWith(`sub/${user.id}/`) || key.includes("..") || !/^[A-Za-z0-9/._-]+\.jpg$/.test(key)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const dim = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 20000 ? v : null);
  const db = (await import("@/lib/supabase/admin")).createAdminClient();
  const { data: post } = await db.from("sub_posts").select("creator_id").eq("id", id).maybeSingle();
  if ((post as { creator_id?: string } | null)?.creator_id !== user.id) return NextResponse.json({ error: "Not yours." }, { status: 403 });
  // the preview must really be an image (Part 2, lib/sub/upload-check.ts)
  const [{ readPrivatePrefix }, { checkUpload }] = await Promise.all([import("@/lib/storage/r2"), import("@/lib/sub/upload-check")]);
  if (!checkUpload("image", await readPrivatePrefix(key)).ok) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { error } = await db.from("sub_post_media").update({ thumb_key: key }).eq("post_id", id).eq("idx", idx).is("thumb_key", null);
  if (error) return NextResponse.json({ error: "Couldn't save the preview." }, { status: 500 });
  const w = dim(body?.width);
  const h = dim(body?.height);
  if (w && h) await db.from("sub_post_media").update({ width: w, height: h }).eq("post_id", id).eq("idx", idx).is("width", null);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";

import { ensureOriginalSound } from "@/lib/social/original-sound";
import { profilePath } from "@/lib/social/profile-url";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/sounds/from-post/:postId — where a reel's spinning sound ring goes (0308 — owner, 2026-10-30: "the spinning
 * ring is link the creator page instead of the sound page"). Redirects to the reel's sound page: the sound it carries,
 * or its own original sound, made now for a reel from before every reel got one (lib/social/original-sound.ts). A post
 * whose audio can't be a sound (saved from another platform, private, before 0308) goes to its creator's profile, as
 * the ring always did.
 */
/**
 * POST — the same answer as JSON ({ soundId } or null), for the reel viewer's warm-up (owner, 2026-10-30: "the sound
 * button is supposed to warm and prefetch so it opens instantly"): asked once a reel has been the ACTIVE one for a
 * moment — never for reels scrolled past — so the ring can prefetch the sound page before it is tapped.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  if (!UUID.test(postId)) return NextResponse.json({ soundId: null }, { status: 400 });
  return NextResponse.json({ soundId: await ensureOriginalSound(postId) }, { headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const home = new URL("/sounds", request.url);
  if (!UUID.test(postId)) return NextResponse.redirect(home);
  const soundId = await ensureOriginalSound(postId);
  if (soundId) return NextResponse.redirect(new URL(`/sound/${soundId}`, request.url));
  const { data: post } = await createAdminClient().from("posts").select("publisher_id").eq("id", postId).maybeSingle();
  const { data: prof } = post ? await createAdminClient().from("profiles").select("handle").eq("id", post.publisher_id as string).maybeSingle() : { data: null };
  return NextResponse.redirect(prof?.handle ? new URL(profilePath(prof.handle as string), request.url) : home);
}

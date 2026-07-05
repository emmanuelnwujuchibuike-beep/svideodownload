import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestUser } from "@/lib/auth/request-user";
import { listViewableCollections, myCollectionsWithMembership } from "@/lib/social/collections";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/collections
 *   ?post=<id>  → the signed-in user's own collections, each flagged with whether
 *                 it already contains that post (powers the "Save to collection" picker).
 *   ?user=<id>  → the collections of that profile the viewer is allowed to see
 *                 (powers the profile Collections tab).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const post = searchParams.get("post");
  const user = searchParams.get("user");
  const me = await getRequestUser(request);

  if (post) {
    if (!me) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    return NextResponse.json({ collections: await myCollectionsWithMembership(me.id, post) });
  }

  if (user) {
    let isFollowing = false;
    if (me && me.id !== user) {
      try {
        const { count } = await createAdminClient()
          .from("follows")
          .select("follower_id", { head: true, count: "exact" })
          .eq("follower_id", me.id)
          .eq("following_id", user);
        isFollowing = (count ?? 0) > 0;
      } catch {
        /* best-effort */
      }
    }
    return NextResponse.json({ collections: await listViewableCollections(user, me?.id ?? null, isFollowing) });
  }

  return NextResponse.json({ error: "Missing ?post or ?user." }, { status: 400 });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  visibility: z.enum(["public", "followers", "private"]).optional(),
});

/** POST /api/collections — create a collection. Returns the new id. */
export async function POST(request: Request) {
  const me = await getRequestUser(request);
  if (!me) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Give the collection a name." }, { status: 400 });

  try {
    const { data, error } = await createAdminClient()
      .from("collections")
      .insert({ user_id: me.id, name: parsed.data.name, visibility: parsed.data.visibility ?? "private" })
      .select("id, name, visibility")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, collection: data });
  } catch (e) {
    // 42P01 = table missing (migration 0027 not applied yet).
    const code = (e as { code?: string })?.code;
    if (code === "42P01") return NextResponse.json({ error: "Collections aren't available yet." }, { status: 503 });
    return NextResponse.json({ error: "Couldn't create the collection." }, { status: 500 });
  }
}

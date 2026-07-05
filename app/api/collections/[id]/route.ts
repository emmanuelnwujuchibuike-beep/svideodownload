import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { getCollectionMeta, ownsCollection } from "@/lib/social/collections";
import { listCollectionPosts } from "@/lib/social/posts";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/collections/:id — a collection's meta + its posts (visibility-checked). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getRequestUser(request);
  const meta = await getCollectionMeta(id, me?.id ?? null);
  if (!meta) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const posts = await listCollectionPosts(id, me?.id ?? null);
  return NextResponse.json({ collection: meta, posts });
}

/** DELETE /api/collections/:id — delete the whole collection (owner only). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getRequestUser(request);
  if (!me) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!(await ownsCollection(id, me.id))) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  try {
    const { error } = await createAdminClient().from("collections").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't delete." }, { status: 500 });
  }
}

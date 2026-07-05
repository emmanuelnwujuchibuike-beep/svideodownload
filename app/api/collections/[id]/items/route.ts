import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestUser } from "@/lib/auth/request-user";
import { ownsCollection } from "@/lib/social/collections";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ postId: z.string().uuid() });

async function authorize(request: Request, id: string) {
  const me = await getRequestUser(request);
  if (!me) return { error: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  if (!(await ownsCollection(id, me.id))) return { error: NextResponse.json({ error: "Not allowed." }, { status: 403 }) };
  return { me };
}

async function body(request: Request) {
  try {
    return schema.safeParse(await request.json());
  } catch {
    return schema.safeParse(null);
  }
}

/** POST /api/collections/:id/items — add a post to the collection (idempotent). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(request, id);
  if ("error" in auth) return auth.error;
  const parsed = await body(request);
  if (!parsed.success) return NextResponse.json({ error: "Invalid post." }, { status: 400 });

  try {
    const db = createAdminClient();
    const { error } = await db
      .from("collection_items")
      .insert({ collection_id: id, post_id: parsed.data.postId });
    // 23505 = already in the collection → treat as success (idempotent).
    if (error && (error as { code?: string }).code !== "23505") throw error;
    await db.from("collections").update({ updated_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ ok: true, added: true });
  } catch {
    return NextResponse.json({ error: "Couldn't add to the collection." }, { status: 500 });
  }
}

/** DELETE /api/collections/:id/items — remove a post from the collection. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(request, id);
  if ("error" in auth) return auth.error;
  const parsed = await body(request);
  if (!parsed.success) return NextResponse.json({ error: "Invalid post." }, { status: 400 });

  try {
    const db = createAdminClient();
    const { error } = await db
      .from("collection_items")
      .delete()
      .eq("collection_id", id)
      .eq("post_id", parsed.data.postId);
    if (error) throw error;
    return NextResponse.json({ ok: true, added: false });
  } catch {
    return NextResponse.json({ error: "Couldn't remove from the collection." }, { status: 500 });
  }
}

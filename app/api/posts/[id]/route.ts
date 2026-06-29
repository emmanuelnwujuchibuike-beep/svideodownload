import { NextResponse } from "next/server";
import { z } from "zod";

import { CATEGORIES } from "@/lib/social/categories";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.enum(CATEGORIES).nullable().optional(),
  visibility: z.enum(["public", "followers", "private"]).optional(),
});

/** PATCH /api/posts/:id — edit own post (RLS enforces ownership). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

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
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing valid to update." }, { status: 400 });
  }

  const { error } = await supabase
    .from("posts")
    .update(parsed.data)
    .eq("id", id)
    .eq("publisher_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't update." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/posts/:id — remove own post. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { error } = await supabase.from("posts").delete().eq("id", id).eq("publisher_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

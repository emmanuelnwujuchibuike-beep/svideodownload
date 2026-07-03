import { NextResponse } from "next/server";
import { z } from "zod";

import { getPoll } from "@/lib/social/polls";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/posts/:id/poll — fresh poll view (results + who voted publicly). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
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
  const poll = await getPoll(id, viewerId);
  return NextResponse.json({ poll }, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z.object({
  question: z.string().trim().max(200).optional().default(""),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(6),
  allowMultiple: z.boolean().optional().default(false),
  closesAt: z.string().datetime().nullable().optional(),
});

/** POST /api/posts/:id/poll — the post owner attaches a poll (vote). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data: post } = await supabase.from("posts").select("publisher_id").eq("id", id).maybeSingle();
  if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (post.publisher_id !== user.id) return NextResponse.json({ error: "Only the creator can add a poll." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Add a question and at least two options." }, { status: 400 });

  const options = parsed.data.options.map((o) => o.trim()).filter(Boolean);
  if (options.length < 2) return NextResponse.json({ error: "Add at least two options." }, { status: 400 });

  // One poll per post — replace any existing one (cascades to options/votes).
  await supabase.from("post_polls").delete().eq("post_id", id);

  const { data: poll, error } = await supabase
    .from("post_polls")
    .insert({
      post_id: id,
      owner_id: user.id,
      question: parsed.data.question ?? "",
      allow_multiple: parsed.data.allowMultiple ?? false,
      closes_at: parsed.data.closesAt ?? null,
    })
    .select("id")
    .single();
  if (error || !poll) {
    const msg = /column|schema|relation/i.test(error?.message ?? "") ? "Polls aren't enabled yet." : "Couldn't create the poll.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const rows = options.map((label, i) => ({ poll_id: poll.id, position: i, label }));
  const { error: oErr } = await supabase.from("poll_options").insert(rows);
  if (oErr) {
    await supabase.from("post_polls").delete().eq("id", poll.id);
    return NextResponse.json({ error: "Couldn't create the poll." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: poll.id });
}

/** DELETE /api/posts/:id/poll — the owner removes the poll. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  // RLS restricts deletes to the poll owner.
  const { error } = await supabase.from("post_polls").delete().eq("post_id", id).eq("owner_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't remove the poll." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

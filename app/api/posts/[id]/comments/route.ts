import { NextResponse } from "next/server";
import { z } from "zod";

import { assistantLimiter } from "@/lib/rate-limit";
import { canComment, commentSpamReason } from "@/lib/social/engagement";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({
  body: z.string().trim().min(1).max(1000),
  parentId: z.string().uuid().nullable().optional(),
});

const GATE_MSG: Record<string, string> = {
  off: "Comments are turned off for this post.",
  followers: "Only the creator's followers can comment.",
  blocked: "You can't comment here.",
  unavailable: "This post isn't available.",
};

/** POST /api/posts/:id/comments — add a comment (policy + anti-spam gated). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  // Trust/account gate.
  const { data: prof } = await supabase
    .from("profiles")
    .select("is_suspended")
    .eq("id", user.id)
    .maybeSingle();
  if (prof?.is_suspended) return NextResponse.json({ error: "Your account can't comment." }, { status: 403 });

  const { success } = await assistantLimiter.limit(`comment:${user.id}`);
  if (!success) return NextResponse.json({ error: "You're commenting too fast." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Write a comment first." }, { status: 400 });

  const spam = commentSpamReason(parsed.data.body);
  if (spam) return NextResponse.json({ error: spam }, { status: 400 });

  const gate = await canComment(id, user.id);
  if (!gate.ok) return NextResponse.json({ error: GATE_MSG[gate.reason] }, { status: 403 });

  // Keep threads exactly one level deep: a reply to a reply attaches to the
  // top-level parent. Ignore parents that aren't on this post.
  let parentId = parsed.data.parentId ?? null;
  if (parentId) {
    const { data: parent } = await supabase
      .from("post_comments")
      .select("post_id, parent_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!parent || parent.post_id !== id) parentId = null;
    else if (parent.parent_id) parentId = parent.parent_id as string;
  }

  const { data, error } = await supabase
    .from("post_comments")
    .insert({
      post_id: id,
      author_id: user.id,
      parent_id: parentId,
      body: parsed.data.body.trim(),
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: "Couldn't post comment." }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

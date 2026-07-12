import { after, NextResponse } from "next/server";
import { z } from "zod";

import { pushSocialEvent } from "@/lib/push/social-push";
import { trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({
  type: z.enum(["like", "save"]),
  // The long-press reaction picker's flavor — stored on the SAME like row
  // (counts/notifications unchanged); omitted = the plain Wow.
  emotion: z.enum(["love", "fire", "funny", "applause", "surprised", "celebrate", "insightful", "support"]).optional(),
});

async function ctx(request: Request, idPromise: Promise<{ id: string }>) {
  const { id } = await idPromise;
  if (!UUID.test(id)) return { error: NextResponse.json({ error: "Bad id." }, { status: 400 }) } as const;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Sign in required." }, { status: 401 }) } as const;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: NextResponse.json({ error: "Invalid request." }, { status: 400 }) } as const;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { error: NextResponse.json({ error: "Invalid type." }, { status: 400 }) } as const;
  return { supabase, user, id, type: parsed.data.type, emotion: parsed.data.emotion } as const;
}

/** POST /api/posts/:id/react — add a like/save. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx(request, params);
  if ("error" in c) return c.error;

  const { success } = await trackLimiter.limit(`react:${c.user.id}`);
  if (!success) return NextResponse.json({ error: "Slow down." }, { status: 429 });

  const emotion = c.type === "like" ? (c.emotion ?? null) : null;
  let { error } = await c.supabase
    .from("post_reactions")
    .insert({ user_id: c.user.id, post_id: c.id, type: c.type, emotion });
  // Pre-migration-0033 the column doesn't exist — insert the plain reaction.
  if (error?.code === "42703") {
    ({ error } = await c.supabase
      .from("post_reactions")
      .insert({ user_id: c.user.id, post_id: c.id, type: c.type }));
  }
  // Already reacted: picking a (different) flavor UPDATES the same row —
  // changing your reaction never double-counts; otherwise a success no-op.
  if (error?.code === "23505") {
    if (emotion !== null) {
      await c.supabase
        .from("post_reactions")
        .update({ emotion })
        .eq("user_id", c.user.id)
        .eq("post_id", c.id)
        .eq("type", c.type)
        .then(
          (r) => r,
          () => null,
        );
    }
    return NextResponse.json({ ok: true, active: true });
  }
  if (error) {
    return NextResponse.json({ error: "Couldn't react." }, { status: 400 });
  }
  // Fresh reaction only (not the duplicate no-op): device push to the post owner.
  // after(), not bare void — see lib/social/messages.ts's sendMessage() for why.
  after(() => pushSocialEvent({ actorId: c.user.id, type: c.type, postId: c.id }));
  return NextResponse.json({ ok: true, active: true });
}

/** DELETE /api/posts/:id/react — remove a like/save. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx(request, params);
  if ("error" in c) return c.error;

  const { error } = await c.supabase
    .from("post_reactions")
    .delete()
    .eq("user_id", c.user.id)
    .eq("post_id", c.id)
    .eq("type", c.type);
  if (error) return NextResponse.json({ error: "Couldn't update." }, { status: 500 });
  return NextResponse.json({ ok: true, active: false });
}

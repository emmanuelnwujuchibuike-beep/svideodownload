import { after as runAfterResponse, NextResponse } from "next/server";

import { checkFollowerMilestone } from "@/lib/social/milestones";
import { pushSocialEvent } from "@/lib/push/social-push";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** POST /api/follow/:id — follow a user. RLS enforces self + block rules. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.id === id) return NextResponse.json({ error: "You can't follow yourself." }, { status: 400 });

  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: user.id, following_id: id });
  // Duplicate (already following) is a success no-op.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Couldn't follow (blocked or unavailable)." }, { status: 400 });
  }
  // Fresh follow only: device push to the followed user.
  if (!error) {
    // runAfterResponse (next/server's `after()`), not bare void — a
    // fire-and-forget call started right before a serverless Route Handler
    // returns isn't guaranteed to finish; Vercel can freeze the function the
    // instant the response is sent. Real cause of "push notifications arrive
    // minutes late" — found 2026-07-12.
    runAfterResponse(() => pushSocialEvent({ actorId: user.id, type: "follow", recipientId: id }));
    // Part 8 milestone check — best-effort, never blocks the response.
    // `followers_count` is trigger-maintained (bump_follow_counts()) and
    // this insert just incremented it by exactly 1, so `after - 1` is the
    // correct "before" value without a second read racing the trigger.
    runAfterResponse(async () => {
      const { data: profile } = await supabase.from("profiles").select("followers_count").eq("id", id).maybeSingle();
      const followersAfter = (profile?.followers_count as number | undefined) ?? null;
      if (followersAfter !== null) await checkFollowerMilestone(id, followersAfter - 1, followersAfter);
    });
  }
  return NextResponse.json({ ok: true, following: true });
}

/** DELETE /api/follow/:id — unfollow a user. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", user.id)
    .eq("following_id", id);
  if (error) return NextResponse.json({ error: "Couldn't unfollow." }, { status: 500 });
  return NextResponse.json({ ok: true, following: false });
}

import { after as runAfterResponse, NextResponse } from "next/server";

import { emit } from "@/lib/platform/event-bus";
import { pushSocialEvent } from "@/lib/push/social-push";
import { isFollowSource } from "@/lib/social/follow-policy";
import { followUser, unfollowUser } from "@/lib/social/follows";
import { checkFollowerMilestone } from "@/lib/social/milestones";
import { createAdminClient } from "@/lib/supabase/admin";
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

// Feature 19 · Part 3 — plain words for every refusal (lib/social/follow-policy.ts)
const ERR: Record<string, { msg: string; status: number }> = {
  self: { msg: "You can't follow yourself.", status: 400 },
  blocked: { msg: "Couldn't follow (blocked or unavailable).", status: 400 },
  policy: { msg: "They aren't accepting new followers right now.", status: 403 },
  hourly: { msg: "That's a lot of follows in a short time. Take a short break and try again.", status: 429 },
  daily: { msg: "You've followed a lot of accounts today. Try again tomorrow.", status: 429 },
  unavailable: { msg: "Couldn't follow (blocked or unavailable).", status: 400 },
};

/**
 * POST /api/follow/:id — follow a user, or ask to (Feature 19 · Part 3).
 *
 * The target's follow_policy (0217) decides: a follow, a request (approval), or
 * a refusal; the anti-automation allowance stops bursts (lib/social/follows.ts).
 * Body (optional): `{ source }` — where the follow came from, counted for the
 * target's Audience page, never shown as who. Answers `{ following, requested }`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { source?: unknown } | null;
  const source = isFollowSource(body?.source) ? body.source : null;

  const res = await followUser(user.id, id, source);
  if (!res.ok) {
    const e = ERR[res.reason] ?? ERR.unavailable!;
    return NextResponse.json({ error: e.msg, reason: res.reason }, { status: e.status });
  }
  if (res.state === "requested") return NextResponse.json({ ok: true, following: false, requested: true });

  // Fresh follow only: device push to the followed user.
  if (res.fresh) {
    emit("follow.created", { followerId: user.id, followeeId: id });
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
      const { data: profile } = await createAdminClient().from("profiles").select("followers_count").eq("id", id).maybeSingle();
      const followersAfter = (profile?.followers_count as number | undefined) ?? null;
      if (followersAfter !== null) await checkFollowerMilestone(id, followersAfter - 1, followersAfter);
    });
  }
  return NextResponse.json({ ok: true, following: true, requested: false });
}

/** DELETE /api/follow/:id — unfollow a user, and withdraw a pending follow request. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  try {
    await unfollowUser(user.id, id);
  } catch {
    return NextResponse.json({ error: "Couldn't unfollow." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, following: false, requested: false });
}

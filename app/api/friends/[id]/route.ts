import { NextResponse } from "next/server";
import { z } from "zod";

import { assistantLimiter } from "@/lib/rate-limit";
import {
  cancelFriendRequest,
  friendshipState,
  respondToFriendRequest,
  sendFriendRequest,
  unfriend,
} from "@/lib/social/friends";
import { NOTE_MAX, REQUEST_SOURCES } from "@/lib/social/friend-requests/trust";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  // Feature 19 · Part 2: "ignore" — silent, see respondToFriendRequest
  action: z.enum(["request", "accept", "decline", "ignore"]),
  note: z.string().trim().max(NOTE_MAX).optional(),
  /** Accept As: a relationship label applied on accept (validated by resolveLabelInput) */
  as: z.string().trim().min(1).max(32).optional(),
  /** Where the request was sent from — context for the receiver and the spam review */
  source: z.enum(REQUEST_SOURCES).optional(),
});

const ERR: Record<string, { msg: string; status: number }> = {
  self: { msg: "That's you.", status: 400 },
  blocked: { msg: "You can't send a request to this user.", status: 400 },
  exists: { msg: "You're already friends.", status: 400 },
  incoming: { msg: "They already sent you a request — check your requests.", status: 409 },
  cap: { msg: "You've sent a lot of requests today. Try again tomorrow.", status: 429 },
  unavailable: { msg: "Couldn't update friendship right now.", status: 400 },
  // Feature 19 · Part 2 — plain words, never a score (lib/social/friend-requests/trust.ts)
  policy: { msg: "They aren't taking friend requests from everyone right now. You can still follow them.", status: 403 },
  cooldown: { msg: "You can't send them another request just yet.", status: 429 },
  hourly: { msg: "That's a lot of requests in a short time. Take a short break and try again.", status: 429 },
  paused: { msg: "Sending friend requests is paused for a day — most of your recent ones weren't accepted.", status: 429 },
  note_link: { msg: "Notes can't include links.", status: 400 },
  note_contact: { msg: "Notes can't include phone numbers, emails or other apps — say hello here instead.", status: 400 },
  note_repeated: { msg: "You've sent this same note to a lot of people today. Write something personal, or send without a note.", status: 429 },
};

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** POST /api/friends/:id — { action: request|accept|decline, note? } toward user :id. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await assistantLimiter.limit(`friend:${user.id}`);
  if (!success) return NextResponse.json({ error: "Slow down." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid action." }, { status: 400 });

  const { action, note, as, source } = parsed.data;
  const res =
    action === "request"
      ? await sendFriendRequest(user.id, id, note, source ?? null)
      : await respondToFriendRequest(user.id, id, action, { as: action === "accept" ? (as ?? null) : null });

  if (!res.ok) {
    const e = ERR[res.reason] ?? { msg: "Couldn't update friendship right now.", status: 400 };
    return NextResponse.json({ error: e.msg, reason: res.reason }, { status: e.status });
  }
  return NextResponse.json({ ok: true, state: res.state });
}

/** DELETE /api/friends/:id — cancel your pending request, or unfriend. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const state = await friendshipState(user.id, id);
  const res =
    state === "friends" ? await unfriend(user.id, id) : await cancelFriendRequest(user.id, id);
  if (!res.ok) return NextResponse.json({ error: "Couldn't update." }, { status: 400 });
  return NextResponse.json({ ok: true, state: res.state });
}

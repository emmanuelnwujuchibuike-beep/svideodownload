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
import { friendErrorFor } from "@/lib/social/friend-requests/errors";
import { NOTE_MAX, REQUEST_SOURCES } from "@/lib/social/friend-requests/trust";
import { bumpSuggestionVersion } from "@/lib/social/people/engine";
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
    const e = friendErrorFor(res.reason);
    return NextResponse.json({ error: e.msg, reason: res.reason }, { status: e.status });
  }
  // Suggestions are cached 60 s per person; without this the one just requested came back as "Add".
  await Promise.all([bumpSuggestionVersion(user.id), bumpSuggestionVersion(id)]);
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
  await Promise.all([bumpSuggestionVersion(user.id), bumpSuggestionVersion(id)]);
  return NextResponse.json({ ok: true, state: res.state });
}

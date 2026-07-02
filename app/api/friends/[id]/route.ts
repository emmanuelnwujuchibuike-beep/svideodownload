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
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  action: z.enum(["request", "accept", "decline"]),
  note: z.string().trim().max(150).optional(),
});

const ERR: Record<string, { msg: string; status: number }> = {
  self: { msg: "That's you.", status: 400 },
  blocked: { msg: "You can't send a request to this user.", status: 400 },
  exists: { msg: "You're already friends.", status: 400 },
  incoming: { msg: "They already sent you a request — check your requests.", status: 409 },
  cap: { msg: "You've sent a lot of requests today. Try again tomorrow.", status: 429 },
  unavailable: { msg: "Couldn't update friendship right now.", status: 400 },
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

  const { action, note } = parsed.data;
  const res =
    action === "request"
      ? await sendFriendRequest(user.id, id, note)
      : await respondToFriendRequest(user.id, id, action);

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

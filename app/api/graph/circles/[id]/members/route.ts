import { NextResponse } from "next/server";
import { z } from "zod";

import { MAX_MEMBERS_PER_CIRCLE } from "@/lib/social/graph/circles";
import { circleMemberIds } from "@/lib/social/graph/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ memberId: z.string().regex(UUID) });

/**
 * Add or remove someone from one of your circles.
 *
 * ── Who may be put in a circle ────────────────────────────────────────────
 * Anyone the owner has an edge to, and nobody else. A circle is private, so
 * the person added is never notified and never learns of it — which is exactly
 * why the API must not accept arbitrary user ids. Without this check a circle
 * becomes a way to build and hold a private dossier of accounts a member has
 * no relationship with, and "who has quietly filed me" becomes a question the
 * platform has an answer to and no way to surface.
 *
 * Blocked accounts are refused in both directions for the obvious reason.
 */
async function assertConnected(ownerId: string, memberId: string): Promise<boolean> {
  const db = createAdminClient();
  const [low, high] = ownerId < memberId ? [ownerId, memberId] : [memberId, ownerId];
  try {
    const [{ data: blocked }, { data: friend }, { data: follow }] = await Promise.all([
      db
        .from("blocks")
        .select("blocker_id")
        .or(
          `and(blocker_id.eq.${ownerId},blocked_id.eq.${memberId}),and(blocker_id.eq.${memberId},blocked_id.eq.${ownerId})`,
        )
        .limit(1),
      db.from("friendships").select("user_low").eq("user_low", low).eq("user_high", high).limit(1),
      db
        .from("follows")
        .select("follower_id")
        .or(
          `and(follower_id.eq.${ownerId},following_id.eq.${memberId}),and(follower_id.eq.${memberId},following_id.eq.${ownerId})`,
        )
        .limit(1),
    ]);
    if ((blocked ?? []).length > 0) return false;
    return (friend ?? []).length > 0 || (follow ?? []).length > 0;
  } catch {
    // Fail closed: unable to prove a connection means no.
    return false;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (!parsed.success) return NextResponse.json({ error: "Bad member id." }, { status: 400 });
  const memberId = parsed.data.memberId;
  if (memberId === user.id) return NextResponse.json({ error: "You're already in every circle." }, { status: 400 });

  if (!(await assertConnected(user.id, memberId))) {
    return NextResponse.json({ error: "You can only add people you're connected to." }, { status: 403 });
  }

  const current = await circleMemberIds(user.id, id);
  if (current.length >= MAX_MEMBERS_PER_CIRCLE) {
    return NextResponse.json({ error: `A circle holds up to ${MAX_MEMBERS_PER_CIRCLE} people.` }, { status: 400 });
  }

  try {
    // owner_id is stamped from the circle by the 0112 trigger, so a forged
    // owner in the payload cannot land — but it is sent correctly anyway.
    const { error } = await createAdminClient()
      .from("circle_members")
      .upsert({ circle_id: id, member_id: memberId, owner_id: user.id }, { onConflict: "circle_id,member_id" });
    if (error) {
      return NextResponse.json(
        { error: "Circles aren't available yet. Ask an admin to apply the latest database update." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't add them." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const memberId = new URL(request.url).searchParams.get("memberId") ?? "";
  if (!UUID.test(memberId)) return NextResponse.json({ error: "Bad member id." }, { status: 400 });

  try {
    const { error } = await createAdminClient()
      .from("circle_members")
      .delete()
      .eq("circle_id", id)
      .eq("member_id", memberId)
      .eq("owner_id", user.id);
    if (error) return NextResponse.json({ error: "Couldn't remove them." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't remove them." }, { status: 500 });
  }
}

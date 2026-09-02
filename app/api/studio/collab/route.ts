import { NextResponse } from "next/server";
import { z } from "zod";

import { inviteCollaborator, removeCollaborator, respondToInvite } from "@/lib/creator/collab";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Collaboration invites (Feature 15 Part 9).
 *
 * POST   — the post's owner invites someone by handle.
 * PATCH  — the INVITEE accepts or declines. Note the asymmetry: `respondToInvite`
 *          matches on `user_id = <caller>`, so an owner cannot accept on
 *          somebody else's behalf, which is the whole point of an invite.
 * DELETE — the owner removes a collaborator.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inviteSchema = z.object({
  postId: z.string().regex(UUID),
  handle: z.string().trim().min(1).max(40),
  role: z.enum(["collaborator", "co_author"]).optional(),
});

const respondSchema = z.object({
  postId: z.string().regex(UUID),
  accept: z.boolean(),
});

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a handle." }, { status: 400 });

  const res = await inviteCollaborator(
    parsed.data.postId,
    user.id,
    parsed.data.handle,
    parsed.data.role ?? "collaborator",
  );
  return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 400 });
}

export async function PATCH(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const res = await respondToInvite(parsed.data.postId, user.id, parsed.data.accept);
  return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 400 });
}

export async function DELETE(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const url = new URL(request.url);
  const postId = url.searchParams.get("postId") ?? "";
  const userId = url.searchParams.get("userId") ?? "";
  if (!UUID.test(postId) || !UUID.test(userId)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const ok = await removeCollaborator(postId, user.id, userId);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Couldn't remove." }, { status: 400 });
}

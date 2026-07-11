import { NextResponse } from "next/server";
import { z } from "zod";

import { removeGroupMember, setMemberRole, transferOwnership } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ role: z.enum(["admin", "member", "owner"]) });

/** DELETE /api/conversations/[id]/members/[userId] — leave (self) or remove (owner/admin). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  if (!UUID.test(id) || !UUID.test(userId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const res = await removeGroupMember(id, user.id, userId);
  if (!res.ok) return NextResponse.json({ error: reasonToMessage(res.reason) }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** PATCH /api/conversations/[id]/members/[userId] — change role (owner-only; `role:"owner"` transfers ownership). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  if (!UUID.test(id) || !UUID.test(userId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid role." }, { status: 400 });

  const res =
    parsed.data.role === "owner"
      ? await transferOwnership(id, user.id, userId)
      : await setMemberRole(id, user.id, userId, parsed.data.role);
  if (!res.ok) return NextResponse.json({ error: reasonToMessage(res.reason) }, { status: 400 });
  return NextResponse.json({ ok: true });
}

function reasonToMessage(reason?: string): string {
  switch (reason) {
    case "forbidden":
      return "Only the group owner or an admin can do that.";
    case "owner_must_transfer":
      return "Transfer ownership before leaving.";
    case "cannot_remove_owner":
      return "The owner can't be removed — transfer ownership first.";
    case "not_a_member":
    case "invalid_target":
      return "That person isn't in this group.";
    default:
      return "Couldn't complete that.";
  }
}

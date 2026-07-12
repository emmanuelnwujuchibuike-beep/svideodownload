import { NextResponse } from "next/server";
import { z } from "zod";

import { GROUP_TITLE_MAX, renameGroup, setGroupAvatar, setGroupSendPermission } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({
  title: z.string().trim().min(1).max(GROUP_TITLE_MAX).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  onlyAdminsCanSend: z.boolean().optional(),
});

/** PATCH /api/conversations/[id] — rename/re-avatar/send-permission a group (owner/admin only). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

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
  if (!parsed.success) return NextResponse.json({ error: "Invalid update." }, { status: 400 });
  if (parsed.data.title === undefined && parsed.data.avatarUrl === undefined && parsed.data.onlyAdminsCanSend === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  if (parsed.data.title !== undefined) {
    const res = await renameGroup(id, user.id, parsed.data.title);
    if (!res.ok) return NextResponse.json({ error: "Couldn't rename the group." }, { status: 403 });
  }
  if (parsed.data.avatarUrl !== undefined) {
    const res = await setGroupAvatar(id, user.id, parsed.data.avatarUrl);
    if (!res.ok) return NextResponse.json({ error: "Couldn't update the group photo." }, { status: 403 });
  }
  if (parsed.data.onlyAdminsCanSend !== undefined) {
    const res = await setGroupSendPermission(id, user.id, parsed.data.onlyAdminsCanSend);
    if (!res.ok) return NextResponse.json({ error: "Couldn't update message permissions." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}

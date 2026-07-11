import { NextResponse } from "next/server";
import { z } from "zod";

import { addGroupMembers, getConversation, MAX_GROUP_MEMBERS } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(MAX_GROUP_MEMBERS) });

/** GET /api/conversations/[id]/members — the roster (any active member). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ members: [] }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ members: [] }, { status: 401 });

  const view = await getConversation(id, user.id);
  if (!view || view.type !== "group") return NextResponse.json({ members: [] }, { status: 404 });
  return NextResponse.json({ members: view.members }, { headers: { "Cache-Control": "private, no-store" } });
}

/** POST /api/conversations/[id]/members — add people to a group (owner/admin only). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (!parsed.success) return NextResponse.json({ error: "Pick at least one person." }, { status: 400 });

  const res = await addGroupMembers(id, user.id, parsed.data.userIds);
  if (!res.ok) return NextResponse.json({ error: "Couldn't add everyone selected." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

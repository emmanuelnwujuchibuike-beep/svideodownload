import { NextResponse } from "next/server";
import { z } from "zod";

import { setConversationPrefs } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({
  muted: z.boolean().optional(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

/** PATCH /api/conversations/[id]/me — mute/archive/pin this conversation for yourself. */
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

  const res = await setConversationPrefs(user.id, id, parsed.data);
  if (!res.ok) return NextResponse.json({ error: "Couldn't update." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

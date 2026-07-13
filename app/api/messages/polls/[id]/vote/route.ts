import { NextResponse } from "next/server";
import { z } from "zod";

import { votePoll } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ optionIndex: z.number().int().min(0) });

/** POST /api/messages/polls/[id]/vote — cast/change the viewer's vote. */
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid vote." }, { status: 400 });

  const res = await votePoll(id, user.id, parsed.data.optionIndex);
  if (!res.ok) return NextResponse.json({ error: "Couldn't record your vote." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

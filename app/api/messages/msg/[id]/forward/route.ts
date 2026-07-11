import { NextResponse } from "next/server";
import { z } from "zod";

import { messageLimiter } from "@/lib/rate-limit";
import { forwardMessage } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ to: z.array(z.string().uuid()).min(1).max(20) });

/**
 * POST /api/messages/msg/[id]/forward — forward a message into one or more
 * of the sender's OWN conversations (direct or group). Each target is a full
 * `sendMessage` call under the hood, so it costs the same rate-limit budget
 * as a normal send.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await messageLimiter.limit(`msg:${user.id}`);
  if (!success) return NextResponse.json({ error: "You're sending messages too fast." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Choose at least one chat." }, { status: 400 });

  const res = await forwardMessage(user.id, id, parsed.data.to);
  if (!res.ok) return NextResponse.json({ error: "Couldn't forward that message." }, { status: 400 });
  return NextResponse.json({ ok: true, sent: res.sent });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { createPoll } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  conversationId: z.string().uuid(),
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(6),
});

/** POST /api/messages/polls — create a poll message (owner mockup completion). */
export async function POST(request: Request) {
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
  if (!parsed.success) return NextResponse.json({ error: "A poll needs a question and at least 2 options." }, { status: 400 });

  const res = await createPoll(user.id, parsed.data.conversationId, parsed.data.question, parsed.data.options);
  if (!res.ok) return NextResponse.json({ error: "Couldn't create the poll." }, { status: 400 });

  return NextResponse.json({ ok: true, messageId: res.messageId, pollId: res.pollId });
}

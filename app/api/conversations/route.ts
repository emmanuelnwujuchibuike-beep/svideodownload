import { NextResponse } from "next/server";
import { z } from "zod";

import { assistantLimiter } from "@/lib/rate-limit";
import { createGroupConversation, GROUP_TITLE_MAX, MAX_GROUP_MEMBERS } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().trim().min(1).max(GROUP_TITLE_MAX),
  memberIds: z.array(z.string().uuid()).min(1).max(MAX_GROUP_MEMBERS - 1),
});

/** POST /api/conversations — create a group conversation (creator becomes owner). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await assistantLimiter.limit(`group-create:${user.id}`);
  if (!success) return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Give the group a name and pick some people." }, { status: 400 });

  const res = await createGroupConversation(user.id, parsed.data.memberIds, parsed.data.title);
  if (!res.ok) return NextResponse.json({ error: reasonToMessage(res.reason) }, { status: 400 });
  return NextResponse.json({ ok: true, id: res.id });
}

function reasonToMessage(reason: string): string {
  switch (reason) {
    case "blocked":
      return "Couldn't add everyone selected.";
    case "too_many_members":
      return `Groups are capped at ${MAX_GROUP_MEMBERS} members.`;
    case "title_required":
      return "Give the group a name.";
    case "members_required":
      return "Pick at least one person.";
    default:
      return "Couldn't create the group.";
  }
}

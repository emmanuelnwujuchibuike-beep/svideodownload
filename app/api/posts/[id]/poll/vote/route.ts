import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  optionId: z.string().uuid(),
  isPublic: z.boolean().optional().default(false),
});

/**
 * POST /api/posts/:id/poll/vote — cast (or change) your single vote. `isPublic`
 * decides whether your identity shows on the option; changing it re-votes.
 */
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
  if (!parsed.success) return NextResponse.json({ error: "Pick an option." }, { status: 400 });

  const { data: poll } = await supabase.from("post_polls").select("id, closes_at").eq("post_id", id).maybeSingle();
  if (!poll) return NextResponse.json({ error: "No poll on this post." }, { status: 404 });
  if (poll.closes_at && new Date(poll.closes_at as string).getTime() < Date.now()) {
    return NextResponse.json({ error: "This poll has closed." }, { status: 400 });
  }

  // The option must belong to this poll.
  const { data: opt } = await supabase
    .from("poll_options")
    .select("id")
    .eq("id", parsed.data.optionId)
    .eq("poll_id", poll.id)
    .maybeSingle();
  if (!opt) return NextResponse.json({ error: "Unknown option." }, { status: 400 });

  const { error } = await supabase.from("poll_votes").upsert(
    {
      poll_id: poll.id,
      option_id: parsed.data.optionId,
      user_id: user.id,
      is_public: parsed.data.isPublic ?? false,
    },
    { onConflict: "poll_id,user_id" },
  );
  if (error) return NextResponse.json({ error: "Couldn't record your vote." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

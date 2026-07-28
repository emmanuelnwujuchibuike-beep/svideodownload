import { NextResponse } from "next/server";
import { z } from "zod";

import { getJournalEntries, JOURNAL_CONTENT_MAX } from "@/lib/social/journal";
import { PROFILE_MOODS } from "@/lib/social/profile";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  content: z.string().trim().min(1, "Write something first.").max(JOURNAL_CONTENT_MAX),
  // Reuses the profile's own mood vocabulary (lib/social/profile.ts) rather
  // than a second one just for the journal.
  mood: z.enum(PROFILE_MOODS).nullable().optional().or(z.literal("").transform(() => null)),
});

/** GET /api/journal — the signed-in user's own recent entries, newest first.
 *  Always private; there is no path that returns another user's entries. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const entries = await getJournalEntries(user.id);
  return NextResponse.json({ entries });
}

/** POST /api/journal — write a new private entry. */
export async function POST(request: Request) {
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
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid entry." }, { status: 400 });
  }

  const { error } = await supabase.from("journal_entries").insert({
    user_id: user.id,
    content: parsed.data.content,
    mood: parsed.data.mood ?? null,
  });
  if (error) return NextResponse.json({ error: "Couldn't save your entry." }, { status: 500 });

  return NextResponse.json({ ok: true });
}

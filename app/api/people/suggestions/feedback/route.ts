import { NextResponse } from "next/server";
import { z } from "zod";

import { bumpSuggestionVersion } from "@/lib/social/people/engine";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long "Remind me later" hides someone. */
const SNOOZE_DAYS = 7;

const body = z
  .object({
    subjectId: z.string().uuid(),
    action: z.enum(["hide", "not_interested", "already_know", "later"]),
  })
  .strict();

async function viewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** POST — answer a suggestion: hide, not interested, already know, or later (7 days). Private to the member (RLS, 0221). */
export async function POST(req: Request) {
  const { supabase, user } = await viewer();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.subjectId === user.id) return NextResponse.json({ ok: false }, { status: 400 });
  const { subjectId, action } = parsed.data;
  const { error } = await supabase.from("people_suggestion_feedback").upsert(
    {
      viewer_id: user.id,
      subject_id: subjectId,
      action,
      snooze_until: action === "later" ? new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString() : null,
      created_at: new Date().toISOString(),
    },
    { onConflict: "viewer_id,subject_id" },
  );
  if (error) return NextResponse.json({ ok: false, ready: !/people_suggestion_feedback|schema cache|does not exist/i.test(error.message) }, { status: 503 });
  await bumpSuggestionVersion(user.id);
  return NextResponse.json({ ok: true });
}

/** DELETE ?subjectId= undoes one answer. DELETE with no id is "Reset": every answer is forgotten. */
export async function DELETE(req: Request) {
  const { supabase, user } = await viewer();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const subjectId = new URL(req.url).searchParams.get("subjectId");
  if (subjectId && !z.string().uuid().safeParse(subjectId).success) return NextResponse.json({ ok: false }, { status: 400 });
  let q = supabase.from("people_suggestion_feedback").delete().eq("viewer_id", user.id);
  if (subjectId) q = q.eq("subject_id", subjectId);
  const { error } = await q;
  if (error) return NextResponse.json({ ok: false }, { status: 503 });
  await bumpSuggestionVersion(user.id);
  return NextResponse.json({ ok: true });
}

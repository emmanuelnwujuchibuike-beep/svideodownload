import { NextResponse } from "next/server";
import { z } from "zod";

import { getTimeCapsules, MESSAGE_MAX, MIN_SEAL_MS, TITLE_MAX } from "@/lib/social/time-capsules";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().trim().min(1, "Give your capsule a title.").max(TITLE_MAX),
  message: z.string().trim().min(1, "Write something to seal.").max(MESSAGE_MAX),
  unlockAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid unlock date."),
});

/** GET /api/time-capsules — the signed-in user's own capsules, soonest-unlocking
 *  first. Locked ones never carry their `message` (see lib/social/time-capsules). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const capsules = await getTimeCapsules(user.id);
  return NextResponse.json({ capsules });
}

/** POST /api/time-capsules — seal a new capsule. `unlockAt` must be at least
 *  MIN_SEAL_MS in the future; RLS additionally guarantees a capsule can only
 *  ever be written under its own creator's user_id. */
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
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid capsule." }, { status: 400 });
  }

  const unlockAt = new Date(parsed.data.unlockAt);
  if (unlockAt.getTime() < Date.now() + MIN_SEAL_MS) {
    return NextResponse.json({ error: "Pick a date at least an hour from now — that's what makes it a capsule." }, { status: 400 });
  }

  const { error } = await supabase.from("time_capsules").insert({
    user_id: user.id,
    title: parsed.data.title,
    message: parsed.data.message,
    unlock_at: unlockAt.toISOString(),
  });
  if (error) return NextResponse.json({ error: "Couldn't seal your capsule." }, { status: 500 });

  return NextResponse.json({ ok: true });
}

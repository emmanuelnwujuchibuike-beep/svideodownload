import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { getSoundPrefs, setSoundPrefs } from "@/lib/social/notification-sound-prefs";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULTS = { masterEnabled: true, messageEnabled: true, mentionEnabled: true, reactionEnabled: true, typingEnabled: true };

/** GET /api/notification-sound-prefs — the signed-in user's in-app sound settings. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ prefs: DEFAULTS });

  const prefs = await getSoundPrefs(user.id);
  return NextResponse.json({ prefs }, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z.object({
  masterEnabled: z.boolean().optional(),
  messageEnabled: z.boolean().optional(),
  mentionEnabled: z.boolean().optional(),
  reactionEnabled: z.boolean().optional(),
  typingEnabled: z.boolean().optional(),
});

/** PATCH /api/notification-sound-prefs — update one or more toggles. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await trackLimiter.limit(`sound-prefs:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences." }, { status: 400 });

  const res = await setSoundPrefs(user.id, parsed.data);
  if (!res.ok) return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

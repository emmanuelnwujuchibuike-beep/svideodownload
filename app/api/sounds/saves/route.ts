import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestUser } from "@/lib/auth/request-user";
import { savedSoundIds, setSoundSaved } from "@/lib/social/sound-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET /api/sounds/saves — the member's saved sound ids (the Sounds page's Save buttons). Signed out: none. */
export async function GET(request: Request) {
  const me = await getRequestUser(request);
  return NextResponse.json({ ids: me ? await savedSoundIds(me.id) : [], signedIn: !!me }, { headers: NO_STORE });
}

const body = z.object({ soundId: z.string().uuid(), saved: z.boolean() });

/** POST /api/sounds/saves { soundId, saved } — save or unsave one public sound (0308 sound_saves). */
export async function POST(request: Request) {
  const me = await getRequestUser(request);
  if (!me) return NextResponse.json({ error: "Sign in to save sounds." }, { status: 401, headers: NO_STORE });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });
  const ok = await setSoundSaved(me.id, parsed.data.soundId, parsed.data.saved);
  if (!ok) return NextResponse.json({ error: "Couldn't save that sound." }, { status: 409, headers: NO_STORE });
  return NextResponse.json({ ok: true, saved: parsed.data.saved }, { headers: NO_STORE });
}

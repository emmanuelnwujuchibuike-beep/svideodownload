import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { isFavourite } from "@/lib/sub/favourites";
import { getAlertPrefs, PRIVATE_POST_MODES, setAnnouncementMode, setPrivatePostMode, type PrivatePostMode } from "@/lib/sub/private-notify";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const MODE = z.enum(PRIVATE_POST_MODES as [PrivatePostMode, ...PrivatePostMode[]]);

/**
 * GET ?creator= — how this member hears about the creator's new private posts (`mode`) and
 * subscriber announcements (`announcements`, Part 6), and whether the creator is a favourite —
 * one request for the Exclusive tab. PUT { creator, mode } or { creator, announcements } —
 * change ONE of them; the other preferences on the row are left exactly as they were.
 * The viewer is always the session user.
 */
export async function GET(request: Request) {
  const creator = new URL(request.url).searchParams.get("creator") ?? "";
  if (!UUID.test(creator)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ mode: "off", announcements: "off", favourite: false, signedIn: false });
  const [prefs, favourite] = await Promise.all([getAlertPrefs(user.id, creator), isFavourite(user.id, creator)]);
  return NextResponse.json({ ...prefs, favourite, signedIn: true }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`private-notify:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many changes — try again in a minute." }, { status: 429 });
  const parsed = z
    .union([z.object({ creator: z.string().regex(UUID), mode: MODE }).strict(), z.object({ creator: z.string().regex(UUID), announcements: MODE }).strict()])
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const b = parsed.data;
  const r = "mode" in b ? await setPrivatePostMode(user.id, b.creator, b.mode) : await setAnnouncementMode(user.id, b.creator, b.announcements);
  if (r.pending) return NextResponse.json({ error: "These notifications arrive with the next update." }, { status: 503 });
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
}

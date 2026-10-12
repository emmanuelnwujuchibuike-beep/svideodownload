import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { getPrivatePostMode, PRIVATE_POST_MODES, setPrivatePostMode, type PrivatePostMode } from "@/lib/sub/private-notify";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** GET ?creator= — how this member hears about the creator's new private posts. PUT { creator, mode } — change it. */
export async function GET(request: Request) {
  const creator = new URL(request.url).searchParams.get("creator") ?? "";
  if (!UUID.test(creator)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ mode: "off", signedIn: false });
  const r = await getPrivatePostMode(user.id, creator);
  return NextResponse.json({ ...r, signedIn: true }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`private-notify:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many changes — try again in a minute." }, { status: 429 });
  const parsed = z.object({ creator: z.string().regex(UUID), mode: z.enum(PRIVATE_POST_MODES as [PrivatePostMode, ...PrivatePostMode[]]) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await setPrivatePostMode(user.id, parsed.data.creator, parsed.data.mode);
  if (r.pending) return NextResponse.json({ error: "Private post notifications arrive with the next update." }, { status: 503 });
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
}

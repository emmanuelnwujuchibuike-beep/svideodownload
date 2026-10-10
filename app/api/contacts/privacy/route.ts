import { NextResponse } from "next/server";
import { z } from "zod";

import { getFindable, setFindable } from "@/lib/social/contacts/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/contacts/privacy — who may find me from an address in their contacts. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ findableByEmail: null }, { status: 401 });
  const findableByEmail = await getFindable(supabase, user.id);
  return NextResponse.json({ findableByEmail, ready: findableByEmail !== null }, { headers: { "Cache-Control": "private, no-store" } });
}

const body = z.object({ findableByEmail: z.enum(["everyone", "friends_of_friends", "nobody"]) }).strict();

/** POST /api/contacts/privacy — change it. Takes effect on the very next match, including matches others saved earlier. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const ok = await setFindable(supabase, user.id, parsed.data.findableByEmail);
  return NextResponse.json({ ok }, { status: ok ? 200 : 503 });
}

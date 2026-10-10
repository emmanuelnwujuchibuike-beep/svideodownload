import { NextResponse } from "next/server";

import { clearMatches, savedMatches } from "@/lib/social/contacts/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/contacts/matches — the contact matches I chose to remember, still findable today. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ people: [] }, { status: 401 });
  const people = await savedMatches(supabase, user.id);
  return NextResponse.json({ people: people ?? [], ready: people !== null }, { headers: { "Cache-Control": "private, no-store" } });
}

/** DELETE /api/contacts/matches — forget every remembered match ("delete synced contacts"). */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const ok = await clearMatches(supabase, user.id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
}

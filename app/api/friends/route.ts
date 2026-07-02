import { NextResponse } from "next/server";

import { friendsOverview, runFriendRemindersSoon } from "@/lib/social/friends";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/friends — friends + pending requests for the signed-in user. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ friends: [], incoming: [], outgoing: [] });

  // Piggyback the smart "Start chatting 👋" reminders on this hot path so they
  // fire near-on-time without dedicated cron infra (self-throttled, idempotent).
  runFriendRemindersSoon();

  const overview = await friendsOverview(user.id);
  return NextResponse.json(overview, { headers: { "Cache-Control": "private, no-store" } });
}

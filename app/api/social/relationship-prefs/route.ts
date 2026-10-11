import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long "Not now" quiets a reconnect nudge. */
const SNOOZE_DAYS = 30;

const body = z
  .object({
    friendId: z.string().uuid(),
    action: z.enum(["archive", "unarchive", "snooze_reconnect", "reconnect_off", "reconnect_on"]),
  })
  .strict();

/**
 * POST — the member's private controls for one friend (0223, owner-only):
 * archive (hide from the Friends list and nudges, keep every memory, restore
 * anytime), and the reconnect nudge snoozed for 30 days, off, or back on.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.friendId === user.id) return NextResponse.json({ ok: false }, { status: 400 });
  const { friendId, action } = parsed.data;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> =
    action === "archive" ? { archived_at: now }
    : action === "unarchive" ? { archived_at: null }
    : action === "snooze_reconnect" ? { reconnect_snoozed_until: new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString() }
    : action === "reconnect_off" ? { reconnect_off: true }
    : { reconnect_off: false, reconnect_snoozed_until: null };
  const { error } = await supabase
    .from("relationship_prefs")
    .upsert({ owner_id: user.id, friend_id: friendId, ...patch, updated_at: now }, { onConflict: "owner_id,friend_id" });
  if (error) {
    const missing = /relationship_prefs|schema cache|does not exist/i.test(error.message);
    return NextResponse.json({ ok: false, error: missing ? "This arrives with the next update." : "Couldn't save that." }, { status: missing ? 503 : 500 });
  }
  return NextResponse.json({ ok: true });
}

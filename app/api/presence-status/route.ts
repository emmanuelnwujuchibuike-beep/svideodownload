import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { getDisplayedStatuses, isPresenceStatus, setPresenceStatus } from "@/lib/social/presence-status";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/presence-status?ids=a,b,c — batch lookup, privacy-transformed for the caller. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ statuses: {} }, { status: 401 });

  const { success } = await trackLimiter.limit(`presence-status:${user.id}`);
  if (!success) return NextResponse.json({ statuses: {} }, { status: 429 });

  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID.test(s))
    .slice(0, 100);

  const map = await getDisplayedStatuses(user.id, ids);
  const statuses: Record<string, string> = {};
  const lastSeen: Record<string, string> = {};
  for (const [id, entry] of map) {
    statuses[id] = entry.status;
    if (entry.lastActiveAt) lastSeen[id] = entry.lastActiveAt;
  }
  return NextResponse.json({ statuses, lastSeen }, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z.object({ status: z.string() });

/** PATCH /api/presence-status — set your own status. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await trackLimiter.limit(`presence-status-set:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success || !isPresenceStatus(parsed.data.status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const res = await setPresenceStatus(user.id, parsed.data.status);
  if (!res.ok) return NextResponse.json({ error: "Couldn't update status." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

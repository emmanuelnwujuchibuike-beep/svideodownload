import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { getDisplayedStatuses, isPresenceStatus, setPresenceStatus } from "@/lib/social/presence-status";
import { savePresence } from "@/lib/social/presence/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  // Part 9: the focus / custom status line, auto reply and open-to, only where the target allows this viewer
  const details: Record<string, NonNullable<(typeof map extends Map<string, infer V> ? V : never)["details"]>> = {};
  for (const [id, entry] of map) {
    statuses[id] = entry.status;
    if (entry.lastActiveAt) lastSeen[id] = entry.lastActiveAt;
    if (entry.details && (entry.details.line || entry.details.autoReply || entry.details.openTo.length)) details[id] = entry.details;
  }
  // Part 9: may this member appear on the PUBLIC online channel? Only when their last seen is "everyone" -
  // otherwise anyone on the channel would see them online whatever they chose (use-presence.ts).
  let self: { broadcast: boolean } | undefined;
  if (ids.includes(user.id)) {
    const { data } = await createAdminClient().from("privacy_settings").select("last_seen_visibility").eq("user_id", user.id).maybeSingle();
    self = { broadcast: ((data as { last_seen_visibility?: string } | null)?.last_seen_visibility ?? "everyone") === "everyone" };
  }
  return NextResponse.json({ statuses, lastSeen, details, self }, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z.object({ status: z.string() });

const iso = z.string().max(40).nullable().optional();
/** Part 9: the full presence patch from the Presence page. A body with only {status} keeps the old cheap path (heartbeat, auto-away, the picker). */
const fullSchema = z
  .object({
    status: z.string().optional(),
    customText: z.string().max(200).nullable().optional(),
    customUntil: iso,
    focusMode: z.string().max(20).nullable().optional(),
    focusUntil: iso,
    autoReply: z.string().max(400).nullable().optional(),
    openTo: z.array(z.string().max(30)).max(10).optional(),
    audience: z.string().max(20).optional(),
    audienceCircle: z.string().uuid().nullable().optional(),
  })
  .strict();

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
  if (json && typeof json === "object" && Object.keys(json).some((k) => k !== "status")) {
    const full = fullSchema.safeParse(json);
    if (!full.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const out = await savePresence(user.id, full.data);
    return out.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: out.error }, { status: out.status });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success || !isPresenceStatus(parsed.data.status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const res = await setPresenceStatus(user.id, parsed.data.status);
  if (!res.ok) return NextResponse.json({ error: "Couldn't update status." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

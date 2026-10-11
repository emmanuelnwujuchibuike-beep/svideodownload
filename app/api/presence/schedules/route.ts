import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { deleteSchedule, saveSchedule } from "@/lib/social/presence/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    id: z.string().uuid().optional(),
    mode: z.string().max(20),
    days: z.number().int(),
    startMin: z.number().int(),
    endMin: z.number().int(),
    tz: z.string().max(64),
    enabled: z.boolean(),
  })
  .strict();

async function member() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** POST — create or update one Presence Automation (0224, owner-only, at most 12). */
export async function POST(req: Request) {
  const user = await member();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { success } = await trackLimiter.limit(`presence-schedule:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const out = await saveSchedule(user.id, parsed.data);
  return out.ok ? NextResponse.json({ ok: true, id: out.id }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}

/** DELETE ?id= — remove one of your automations. */
export async function DELETE(req: Request) {
  const user = await member();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false }, { status: 400 });
  return (await deleteSchedule(user.id, id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false }, { status: 500 });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { friendshipContext, NOT_READY, notReady } from "@/lib/social/friendship/api";
import { MESSAGE_MAX, MIN_SEAL_MS, TITLE_MAX } from "@/lib/social/time-capsules-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX),
    message: z.string().trim().min(1).max(MESSAGE_MAX),
    unlockAt: z.string().refine((v) => !Number.isNaN(Date.parse(v))),
  })
  .strict();

/** POST — seal a Time Capsule for this friend. Nobody can read it before it opens: not the friend (0222 policy) and not the app (redacted on read). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await friendshipContext(params);
  if ("error" in c) return c.error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give it a title, a message and an opening date." }, { status: 400 });
  const unlockAt = new Date(parsed.data.unlockAt);
  if (unlockAt.getTime() - Date.now() < MIN_SEAL_MS) return NextResponse.json({ error: "A capsule opens at least an hour from now." }, { status: 400 });
  const { data, error } = await c.supabase
    .from("time_capsules")
    .insert({ user_id: c.user.id, recipient_id: c.friendId, title: parsed.data.title, message: parsed.data.message, unlock_at: unlockAt.toISOString() })
    .select("id, title, unlock_at")
    .maybeSingle();
  if (error) return notReady(error.message) ? NOT_READY() : NextResponse.json({ error: "Couldn't seal that." }, { status: 500 });
  return NextResponse.json({ capsule: data });
}

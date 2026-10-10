import { NextResponse } from "next/server";
import { z } from "zod";

import { friendshipContext, NOT_READY, notReady } from "@/lib/social/friendship/api";
import { HIDEABLE_KINDS } from "@/lib/social/friendship/story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ kind: z.enum(HIDEABLE_KINDS as unknown as [string, ...string[]]), hidden: z.boolean() }).strict();

/** POST { kind, hidden } — take a kind of moment off (or back onto) MY view of this friendship. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await friendshipContext(params);
  if ("error" in c) return c.error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { kind, hidden } = parsed.data;
  const { error } = hidden
    ? await c.supabase.from("friendship_timeline_hidden").upsert({ owner_id: c.user.id, friend_id: c.friendId, kind }, { onConflict: "owner_id,friend_id,kind" })
    : await c.supabase.from("friendship_timeline_hidden").delete().eq("owner_id", c.user.id).eq("friend_id", c.friendId).eq("kind", kind);
  if (error) return notReady(error.message) ? NOT_READY() : NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

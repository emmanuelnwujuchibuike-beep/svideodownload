import { NextResponse } from "next/server";
import { z } from "zod";

import { friendshipContext, NOT_READY, notReady } from "@/lib/social/friendship/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST — add a goal to this friendship's Shared Bucket List (Feature 19 · Part 7). */
export async function POST(req: Request, { params }: Ctx) {
  const c = await friendshipContext(params);
  if ("error" in c) return c.error;
  const parsed = z.object({ title: z.string().trim().min(1).max(120) }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A goal is 1 to 120 characters." }, { status: 400 });
  const { data, error } = await c.supabase
    .from("friend_goals")
    .insert({ user_low: c.low, user_high: c.high, title: parsed.data.title, created_by: c.user.id })
    .select("id, title, created_at")
    .maybeSingle();
  if (error) return notReady(error.message) ? NOT_READY() : NextResponse.json({ error: "Couldn't add that." }, { status: 500 });
  return NextResponse.json({ goal: data });
}

/** PATCH { goalId, done } — tick a goal off, or back on. Either friend may. */
export async function PATCH(req: Request, { params }: Ctx) {
  const c = await friendshipContext(params);
  if ("error" in c) return c.error;
  const parsed = z.object({ goalId: z.string().uuid(), done: z.boolean() }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const patch = parsed.data.done ? { done_at: new Date().toISOString(), done_by: c.user.id } : { done_at: null, done_by: null };
  const { error } = await c.supabase.from("friend_goals").update(patch).eq("id", parsed.data.goalId).eq("user_low", c.low).eq("user_high", c.high);
  if (error) return notReady(error.message) ? NOT_READY() : NextResponse.json({ error: "Couldn't update that." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?goalId= — remove a goal from the list. */
export async function DELETE(req: Request, { params }: Ctx) {
  const c = await friendshipContext(params);
  if ("error" in c) return c.error;
  const goalId = new URL(req.url).searchParams.get("goalId");
  if (!goalId || !z.string().uuid().safeParse(goalId).success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { error } = await c.supabase.from("friend_goals").delete().eq("id", goalId).eq("user_low", c.low).eq("user_high", c.high);
  if (error) return notReady(error.message) ? NOT_READY() : NextResponse.json({ error: "Couldn't remove that." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

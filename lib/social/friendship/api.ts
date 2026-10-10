import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

/**
 * Shared guard for the Friend Profile routes (Feature 19 · Part 7): the
 * signed-in member, the friend from the URL, and proof they are friends NOW.
 * Every write then runs with the member's own session, so the 0222 policies
 * check the same thing again in the database.
 */
export async function friendshipContext(params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return { error: NextResponse.json({ error: "Bad id." }, { status: 400 }) } as const;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Sign in required." }, { status: 401 }) } as const;
  if (user.id === id) return { error: NextResponse.json({ error: "That's you." }, { status: 400 }) } as const;
  const low = user.id < id ? user.id : id;
  const high = user.id < id ? id : user.id;
  const { data } = await supabase.from("friendships").select("user_low").eq("user_low", low).eq("user_high", high).maybeSingle();
  if (!data) return { error: NextResponse.json({ error: "Only friends can do that." }, { status: 403 }) } as const;
  return { supabase, user, friendId: id, low, high } as const;
}

/** A database without migration 0222 answers "not yet" instead of a 500. */
export function notReady(message: string | undefined): boolean {
  return !!message && /friend_goals|friendship_timeline_hidden|recipient_id|schema cache|does not exist/i.test(message);
}

export const NOT_READY = () => NextResponse.json({ error: "This arrives with the next update." }, { status: 503 });

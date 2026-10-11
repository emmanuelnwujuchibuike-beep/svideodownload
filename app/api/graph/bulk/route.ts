import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { bulkApply } from "@/lib/social/lists/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    action: z.enum(["add_to_list", "remove_from_list", "tag", "untag", "favorite", "unfavorite", "archive", "unarchive"]),
    ids: z.array(z.string().uuid()).min(1).max(500),
    listId: z.string().uuid().optional(),
    tag: z.string().max(60).optional(),
  })
  .strict();

/**
 * POST — one action on many people (Feature 19 · Part 10, Relationship Manager).
 * Only people the member is connected to are touched (lib/social/lists/server.ts).
 * The answer names exactly who changed, so the page can undo it with the opposite action.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { success } = await trackLimiter.limit(`graph-bulk:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const { action, ids, listId, tag } = parsed.data;
  const out = await bulkApply(user.id, action, ids, { listId, tag });
  return out.ok ? NextResponse.json(out) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}

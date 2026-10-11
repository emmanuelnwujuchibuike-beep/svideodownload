import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { addRule, applyRules, createSubList, importHandles, mergeLists, removeRule, updateListMeta } from "@/lib/social/lists/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.string().uuid();
const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("meta"), listId: id, parentId: id.nullable().optional(), archived: z.boolean().optional(), description: z.string().max(400).nullable().optional() }).strict(),
  z.object({ op: z.literal("add_rule"), listId: id, rule: z.string().max(20), value: z.string().max(60).nullable().optional() }).strict(),
  z.object({ op: z.literal("remove_rule"), ruleId: id }).strict(),
  z.object({ op: z.literal("apply_rules"), listId: id }).strict(),
  z.object({ op: z.literal("merge"), from: id, into: id }).strict(),
  z.object({ op: z.literal("sub_list"), parentId: id, name: z.string().max(64), ids: z.array(id).max(500) }).strict(),
  z.object({ op: z.literal("import"), listId: id, handles: z.array(z.string().max(40)).min(1).max(500) }).strict(),
]);

/**
 * POST — list operations for the Relationship Manager (Feature 19 · Part 10):
 * nesting, archive and description (0225), rules and applying them, merging two
 * lists (the old one is archived, never deleted), a sub-list from a suggestion,
 * and importing handles. The owner always comes from the session.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { success } = await trackLimiter.limit(`graph-lists:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const b = parsed.data;
  const out =
    b.op === "meta" ? await updateListMeta(user.id, b.listId, { parentId: b.parentId, archived: b.archived, description: b.description })
    : b.op === "add_rule" ? await addRule(user.id, b.listId, b.rule, b.value ?? null)
    : b.op === "remove_rule" ? await removeRule(user.id, b.ruleId)
    : b.op === "apply_rules" ? await applyRules(user.id, b.listId)
    : b.op === "merge" ? await mergeLists(user.id, b.from, b.into)
    : b.op === "sub_list" ? await createSubList(user.id, b.parentId, b.name, b.ids)
    : await importHandles(user.id, b.listId, b.handles);
  return out.ok ? NextResponse.json(out) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applyBulkAction,
  applyContentAction,
  getCreatorContentItem,
  type ContentAction,
} from "@/lib/creator/content";
import { applyTags } from "@/lib/creator/hashtag-performance";
import { CATEGORIES } from "@/lib/social/categories";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/studio/content — content-management actions (Feature 15 Part 9).
 *
 * One route for one and many: `ids` is always an array, so the client has a
 * single code path and a bulk action cannot drift from its single-item
 * equivalent. Ownership is enforced inside `applyContentAction` on every row.
 *
 * ── Why hashtags are written into the caption ────────────────────────────
 * There is no hashtag table in this product; `lib/social/hashtags.ts` parses
 * tags out of the caption, and that caption IS what search and trending read.
 * So editing tags rewrites the caption (`applyTags`), which means an edit here
 * changes real discovery. A separate `hashtags` column would have been tidier
 * and would have affected nothing.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  ids: z.array(z.string().regex(UUID)).min(1).max(100),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("pin"), pinned: z.boolean() }),
    z.object({ kind: z.literal("archive") }),
    z.object({ kind: z.literal("restore") }),
    z.object({ kind: z.literal("schedule"), at: z.string().datetime().nullable() }),
    z.object({ kind: z.literal("publishNow") }),
    z.object({ kind: z.literal("visibility"), visibility: z.enum(["public", "followers", "private"]) }),
    z.object({
      kind: z.literal("edit"),
      title: z.string().trim().max(300).optional(),
      description: z.string().trim().max(5000).nullable().optional(),
      category: z.enum(CATEGORIES).nullable().optional(),
      /** Replaces the caption's tag set. Omitted = leave tags alone. */
      tags: z.array(z.string().max(40)).max(30).optional(),
    }),
  ]),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { ids, action } = parsed.data;

  // Tags need the CURRENT caption to rewrite, so an edit carrying tags is a
  // per-post operation by nature — it cannot be one bulk statement. Applying it
  // to a multi-select would overwrite every selected caption with the first
  // one's body, so it is refused rather than quietly mangling posts.
  if (action.kind === "edit" && action.tags !== undefined) {
    if (ids.length > 1) {
      return NextResponse.json({ error: "Hashtags can only be edited one post at a time." }, { status: 400 });
    }
    const id = ids[0]!;
    // Ownership-scoped read, NOT getPost: getPost applies viewer visibility
    // rules and would refuse the creator their own archived or scheduled post,
    // which is exactly the content this screen exists to manage.
    const post = await getCreatorContentItem(id, user.id);
    if (!post) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const nextTitle = action.title ?? post.title;
    const rewritten = applyTags(nextTitle, action.tags);
    const res = await applyContentAction(id, user.id, {
      kind: "edit",
      title: rewritten,
      description: action.description,
      category: action.category,
    });
    return res.ok
      ? NextResponse.json({ ok: true, changed: 1, title: rewritten })
      : NextResponse.json({ error: res.error ?? "Couldn't save." }, { status: 400 });
  }

  if (ids.length === 1) {
    const res = await applyContentAction(ids[0]!, user.id, action as ContentAction);
    return res.ok
      ? NextResponse.json({ ok: true, changed: 1 })
      : NextResponse.json({ error: res.error ?? "Couldn't save." }, { status: 400 });
  }

  const res = await applyBulkAction(ids, user.id, action as ContentAction);
  return res.ok
    ? NextResponse.json({ ok: true, changed: res.changed, warning: res.error })
    : NextResponse.json({ error: res.error ?? "Couldn't save." }, { status: 400 });
}

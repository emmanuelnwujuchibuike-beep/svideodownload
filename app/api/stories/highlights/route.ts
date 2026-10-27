import { NextResponse } from "next/server";
import { z } from "zod";

import { assistantLimiter } from "@/lib/rate-limit";
import { createHighlight, HIGHLIGHT_ERRORS, HIGHLIGHT_TITLE_MAX, listHighlights, MAX_HIGHLIGHT_ITEMS } from "@/lib/social/story-highlights";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();

async function viewer(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/stories/highlights?user=<id>[&story=<id>] — a member's highlights as the caller may see them (Stories
 * Part 5, lib/social/story-highlights.ts). `story` (the owner's own list only) marks the highlights already holding it,
 * for the "Add to highlight" sheet. Someone the caller may not see answers an empty list, never an error.
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const user = uuid.safeParse(sp.get("user"));
  if (!user.success) return NextResponse.json({ error: "Which member?" }, { status: 400 });
  const story = sp.get("story");
  const me = await viewer();
  const highlights = await listHighlights(user.data, me, story !== null ? { containingStory: uuid.safeParse(story).success ? story : null } : {});
  return NextResponse.json({ highlights }, { headers: { "Cache-Control": "private, no-store" } });
}

const createSchema = z.object({
  title: z.string().max(HIGHLIGHT_TITLE_MAX * 4),
  storyIds: z.array(uuid).min(1).max(MAX_HIGHLIGHT_ITEMS),
});

/** POST /api/stories/highlights { title, storyIds } — a new highlight from the caller's own stories. */
export async function POST(request: Request) {
  const me = await viewer();
  if (!me) return NextResponse.json({ error: "Sign in to keep highlights." }, { status: 401 });
  const { success } = await assistantLimiter.limit(`highlight:${me}`);
  if (!success) return NextResponse.json({ error: "Slow down a little and try again." }, { status: 429 });
  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: HIGHLIGHT_ERRORS.bad_title.msg }, { status: 400 });
  const res = await createHighlight(me, body.data.title, [...new Set(body.data.storyIds)]);
  if (!res.ok) {
    const e = HIGHLIGHT_ERRORS[res.reason];
    return NextResponse.json({ error: e.msg, reason: res.reason }, { status: e.status });
  }
  return NextResponse.json({ id: res.value.id }, { status: 201 });
}

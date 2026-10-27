import { NextResponse } from "next/server";
import { z } from "zod";

import { assistantLimiter } from "@/lib/rate-limit";
import { addStoryToHighlight, HIGHLIGHT_ERRORS, removeFromHighlight } from "@/lib/social/story-highlights";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
type Ctx = { params: Promise<{ id: string }> };

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

async function guard(params: Ctx["params"]): Promise<{ me: string; id: string } | NextResponse> {
  const { id } = await params;
  const me = await viewer();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: HIGHLIGHT_ERRORS.not_found.msg }, { status: 404 });
  const { success } = await assistantLimiter.limit(`highlight:${me}`);
  if (!success) return NextResponse.json({ error: "Slow down a little and try again." }, { status: 429 });
  return { me, id };
}

/** POST /api/stories/highlights/:id/items { storyId } — add one of the caller's own stories. */
export async function POST(request: Request, { params }: Ctx) {
  const g = await guard(params);
  if (g instanceof NextResponse) return g;
  const body = z.object({ storyId: uuid }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: HIGHLIGHT_ERRORS.story_not_found.msg }, { status: 400 });
  const res = await addStoryToHighlight(g.me, g.id, body.data.storyId);
  if (!res.ok) {
    const e = HIGHLIGHT_ERRORS[res.reason];
    return NextResponse.json({ error: e.msg, reason: res.reason }, { status: e.status });
  }
  return NextResponse.json({ added: res.value.added });
}

/** DELETE /api/stories/highlights/:id/items?item=<id> | ?story=<id> — take a story out (the last one deletes the highlight). */
export async function DELETE(request: Request, { params }: Ctx) {
  const g = await guard(params);
  if (g instanceof NextResponse) return g;
  const sp = new URL(request.url).searchParams;
  const item = uuid.safeParse(sp.get("item"));
  const story = uuid.safeParse(sp.get("story"));
  if (!item.success && !story.success) return NextResponse.json({ error: HIGHLIGHT_ERRORS.not_found.msg }, { status: 400 });
  const res = await removeFromHighlight(g.me, g.id, item.success ? { itemId: item.data } : { storyId: story.success ? story.data : undefined });
  if (!res.ok) {
    const e = HIGHLIGHT_ERRORS[res.reason];
    return NextResponse.json({ error: e.msg, reason: res.reason }, { status: e.status });
  }
  return NextResponse.json({ highlightDeleted: res.value.highlightDeleted });
}

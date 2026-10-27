import { NextResponse } from "next/server";
import { z } from "zod";

import { assistantLimiter } from "@/lib/rate-limit";
import { deleteHighlight, getHighlight, HIGHLIGHT_ERRORS, HIGHLIGHT_TITLE_MAX, updateHighlight } from "@/lib/social/story-highlights";
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

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/stories/highlights/:id — one highlight with its stories, if the caller may see its owner's stories. */
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const highlight = await getHighlight(id, await viewer());
  if (!highlight) return NextResponse.json({ error: HIGHLIGHT_ERRORS.not_found.msg }, { status: 404 });
  return NextResponse.json({ highlight }, { headers: { "Cache-Control": "private, no-store" } });
}

const patchSchema = z
  .object({
    title: z.string().max(HIGHLIGHT_TITLE_MAX * 4).optional(),
    coverItemId: uuid.nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.coverItemId !== undefined);

/** PATCH /api/stories/highlights/:id { title?, coverItemId? } — rename it, or pick one of its stories as the cover. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const me = await viewer();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: HIGHLIGHT_ERRORS.not_found.msg }, { status: 404 });
  const { success } = await assistantLimiter.limit(`highlight:${me}`);
  if (!success) return NextResponse.json({ error: "Slow down a little and try again." }, { status: 429 });
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: HIGHLIGHT_ERRORS.bad_title.msg }, { status: 400 });
  const res = await updateHighlight(me, id, body.data);
  if (!res.ok) {
    const e = HIGHLIGHT_ERRORS[res.reason];
    return NextResponse.json({ error: e.msg, reason: res.reason }, { status: e.status });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/stories/highlights/:id — the highlight and everything in it. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const me = await viewer();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: HIGHLIGHT_ERRORS.not_found.msg }, { status: 404 });
  const res = await deleteHighlight(me, id);
  if (!res.ok) {
    const e = HIGHLIGHT_ERRORS[res.reason];
    return NextResponse.json({ error: e.msg, reason: res.reason }, { status: e.status });
  }
  return NextResponse.json({ ok: true });
}

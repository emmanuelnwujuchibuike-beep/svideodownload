import { NextResponse } from "next/server";
import { z } from "zod";

import { HIGHLIGHT_ERRORS, listHighlightViewers, recordHighlightView } from "@/lib/social/story-highlights";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 *   POST /api/stories/highlights/:id/views   record that I opened someone else's highlight (first view only)
 *   GET  /api/stories/highlights/:id/views   the owner's own list of who viewed it
 *
 * Owner, 2026-10-31: "I want users to see who views their highlight" (migration 0312). The rules live in
 * lib/social/story-highlights.ts: a view needs the stories visibility rule and is never the owner's own; the list
 * is the owner's alone.
 */

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

export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const me = await viewer();
  // signed out: nobody to record — a quiet 200, so the viewer's fire-and-forget never errors
  if (!me || !uuid.safeParse(id).success) return NextResponse.json({ ok: true, recorded: false });
  const { recorded } = await recordHighlightView(id, me);
  return NextResponse.json({ ok: true, recorded });
}

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const me = await viewer();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: HIGHLIGHT_ERRORS.not_found.msg }, { status: 404 });
  const res = await listHighlightViewers(me, id);
  if (!res.ok) {
    const e = HIGHLIGHT_ERRORS[res.reason];
    return NextResponse.json({ error: e.msg, reason: res.reason }, { status: e.status });
  }
  return NextResponse.json(res.value, { headers: { "Cache-Control": "private, no-store" } });
}

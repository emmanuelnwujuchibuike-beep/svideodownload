import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getCreatorNotificationPrefs,
  setCreatorNotificationPrefs,
} from "@/lib/social/creator-notifications";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-creator notification preferences for the signed-in viewer.
 *
 * GET  /api/creator-notifications/:id → the viewer's current settings for :id
 * POST /api/creator-notifications/:id → apply a partial change
 *
 * `:id` is the TARGET user (whose activity the notifications are about). The
 * viewer is always taken from the session and never from the request body —
 * accepting a viewer id would let anyone rewrite anyone else's notification
 * settings.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z
  .object({
    posts: z.boolean().optional(),
    stories: z.boolean().optional(),
    feed: z.boolean().optional(),
    shares: z.boolean().optional(),
  })
  // An empty body would be a no-op write; rejecting it keeps a UI bug from
  // looking like a successful save.
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid user." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const prefs = await getCreatorNotificationPrefs(user.id, id);
  return NextResponse.json({ ok: true, prefs });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid user." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.id === id) {
    return NextResponse.json({ error: "You can't notify yourself about your own activity." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const result = await setCreatorNotificationPrefs(user.id, id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  return NextResponse.json({ ok: true, prefs: result.prefs });
}

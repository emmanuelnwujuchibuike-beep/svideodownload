import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteMessage, editMessage } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ body: z.string().trim().min(1).max(2000) });

/**
 * Message-scoped mutations live under their own `/api/messages/msg/[id]`
 * segment (id = MESSAGE id) rather than reusing `/api/messages/[id]`, which
 * already means CONVERSATION id for the catch-up GET endpoint — keeping the
 * two separate avoids an id-type mix-up at the route layer.
 */

/** PATCH /api/messages/msg/[id] — edit your own message. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Write a message." }, { status: 400 });

  const res = await editMessage(user.id, id, parsed.data.body);
  if (!res.ok) return NextResponse.json({ error: "Couldn't edit that message." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/messages/msg/[id] — soft-delete your own message. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const res = await deleteMessage(user.id, id);
  if (!res.ok) return NextResponse.json({ error: "Couldn't delete that message." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

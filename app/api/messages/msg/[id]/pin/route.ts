import { NextResponse } from "next/server";

import { setMessagePinned } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** POST /api/messages/msg/[id]/pin — any active member pins a message. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const res = await setMessagePinned(user.id, id, true);
  if (!res.ok) return NextResponse.json({ error: "Couldn't pin." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** DELETE — unpin. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const res = await setMessagePinned(user.id, id, false);
  if (!res.ok) return NextResponse.json({ error: "Couldn't unpin." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

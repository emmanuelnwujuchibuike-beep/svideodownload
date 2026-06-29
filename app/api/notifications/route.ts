import { NextResponse } from "next/server";

import { listNotifications } from "@/lib/social/notifications";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/notifications — the signed-in user's recent notifications + unread count. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [], unread: 0 }, { status: 200 });

  const result = await listNotifications(user.id, 20);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

/** PATCH /api/notifications — mark all (or one) as read. Body: { id? }. RLS-scoped. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let id: string | undefined;
  try {
    const body = (await request.json()) as { id?: string };
    id = body?.id;
  } catch {
    /* no body → mark all */
  }

  let q = supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
  if (id) q = q.eq("id", id);
  const { error } = await q;
  if (error) return NextResponse.json({ error: "Couldn't update." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";

import { listGroupedNotifications, listNotifications } from "@/lib/social/notifications";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/notifications — the signed-in user's notifications + unread count.
 * `?grouped=1` returns smart-grouped notifications for the Notification Center;
 * the default flat list powers the topbar bell. `?limit=` caps the count.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const url = new URL(request.url);
  const grouped = url.searchParams.get("grouped") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || (grouped ? 60 : 20), 1), 100);

  if (!user) {
    return NextResponse.json(grouped ? { groups: [], unread: 0 } : { items: [], unread: 0 }, { status: 200 });
  }

  const result = grouped
    ? await listGroupedNotifications(user.id, limit)
    : await listNotifications(user.id, limit);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

/** PATCH /api/notifications — mark read. Body: { id? } | { ids?[] } | {} (all). RLS-scoped. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let id: string | undefined;
  let ids: string[] | undefined;
  try {
    const body = (await request.json()) as { id?: string; ids?: string[] };
    id = body?.id;
    ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === "string").slice(0, 200) : undefined;
  } catch {
    /* no body → mark all */
  }

  let q = supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
  if (ids && ids.length) q = q.in("id", ids);
  else if (id) q = q.eq("id", id);
  const { error } = await q;
  if (error) return NextResponse.json({ error: "Couldn't update." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/notifications — remove one, a group, or (Part 8 privacy
 * control) everything. Body: { id? } | { ids?[] } | { all: true }. `all`
 * must be explicit and exactly `true` — an empty/malformed body still 400s,
 * same as before, rather than silently wiping history by accident. RLS-scoped. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let id: string | undefined;
  let ids: string[] | undefined;
  let all = false;
  try {
    const body = (await request.json()) as { id?: string; ids?: string[]; all?: boolean };
    id = body?.id;
    ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === "string").slice(0, 200) : undefined;
    all = body?.all === true;
  } catch {
    return NextResponse.json({ error: "Nothing to delete." }, { status: 400 });
  }

  let q = supabase.from("notifications").delete().eq("user_id", user.id);
  if (all) {
    // No further filter — every row already scoped to this user by the .eq() above.
  } else if (ids && ids.length) q = q.in("id", ids);
  else if (id) q = q.eq("id", id);
  else return NextResponse.json({ error: "Nothing to delete." }, { status: 400 });

  const { error } = await q;
  if (error) return NextResponse.json({ error: "Couldn't delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";

import { hasActivityColumns, listGroupedNotifications, listNotifications } from "@/lib/social/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Feature 20: ?view=archived reads only what the member put away (fetched when that tab opens, never otherwise)
  const view = url.searchParams.get("view") === "archived" ? "archived" : "inbox";
  const result = grouped
    ? await listGroupedNotifications(user.id, limit, view)
    : await listNotifications(user.id, limit);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

const ACTIONS = ["pin", "unpin", "archive", "unarchive"] as const;
type Action = (typeof ACTIONS)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/notifications — mark read. Body: { id? } | { ids?[] } | {} (all). RLS-scoped.
 *
 * Feature 20: { ids, action: "pin" | "unpin" | "archive" | "unarchive" } — always an
 * explicit list (never "all"), always only the caller's own rows. Archiving also marks
 * read, so an archived card never holds the unread count up. 503 before 0233 is live.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let id: string | undefined;
  let ids: string[] | undefined;
  let action: Action | null = null;
  try {
    const body = (await request.json()) as { id?: string; ids?: string[]; action?: string };
    id = body?.id;
    ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === "string").slice(0, 200) : undefined;
    if (body?.action !== undefined) {
      if (!(ACTIONS as readonly string[]).includes(body.action)) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
      action = body.action as Action;
    }
  } catch {
    /* no body → mark all */
  }

  if (action) {
    const list = (ids?.length ? ids : id ? [id] : []).filter((x) => UUID.test(x));
    if (!list.length) return NextResponse.json({ error: "Choose a notification." }, { status: 400 });
    const db = createAdminClient();
    if (!(await hasActivityColumns(db))) return NextResponse.json({ error: "Pin and archive arrive with the next update." }, { status: 503 });
    const now = new Date().toISOString();
    const cols: Record<string, unknown> =
      action === "pin" ? { pinned_at: now } : action === "unpin" ? { pinned_at: null } : action === "archive" ? { archived_at: now, read: true, pinned_at: null } : { archived_at: null };
    // the service role, so the write is explicit about whose rows: only the signed-in member's
    const { error } = await db.from("notifications").update(cols).eq("user_id", user.id).in("id", list);
    if (error) return NextResponse.json({ error: "Couldn't update." }, { status: 500 });
    return NextResponse.json({ ok: true });
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

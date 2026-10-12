import { NextResponse } from "next/server";

import { defaultPriorityFor } from "@/lib/notifications/priority";
import { CATEGORY_BY_TYPE, type NotificationType } from "@/lib/platform/notifications-registry";
import { trackLimiter } from "@/lib/rate-limit";
import { hasActivityColumns } from "@/lib/social/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SMART CLEANUP (Feature 20 Part 3) — suggestions, never automatic.
 *
 *   old_read  read, not pinned, older than 30 days
 *   passive   likes, follows, saves, views and other low-priority signals older than 7 days
 *
 * The brief says "AI suggests"; these are two plain rules the member can read, and
 * the action ARCHIVES (restorable from the Archived tab, still searchable) — it
 * never deletes. Pinned notifications are never touched. GET counts (two head
 * counts, only when the Activity Center opens the suggestion), POST does it.
 */
const DAY = 86_400_000;
const PASSIVE: NotificationType[] = (Object.keys(CATEGORY_BY_TYPE) as NotificationType[]).filter((t) => defaultPriorityFor(t) === "low" && CATEGORY_BY_TYPE[t] !== "security");
type Kind = "old_read" | "passive";

function scoped(db: ReturnType<typeof createAdminClient>, userId: string, kind: Kind, head: boolean) {
  const now = Date.now();
  let q = head ? db.from("notifications").select("id", { head: true, count: "exact" }) : db.from("notifications").update({ archived_at: new Date(now).toISOString(), read: true });
  q = q.eq("user_id", userId).is("archived_at", null).is("pinned_at", null);
  return kind === "old_read"
    ? q.eq("read", true).lt("created_at", new Date(now - 30 * DAY).toISOString())
    : q.in("type", PASSIVE).lt("created_at", new Date(now - 7 * DAY).toISOString());
}

async function member() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await member();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = createAdminClient();
  if (!(await hasActivityColumns(db))) return NextResponse.json({ ready: false, oldRead: 0, passive: 0 });
  const [a, b] = await Promise.all([scoped(db, user.id, "old_read", true), scoped(db, user.id, "passive", true)]);
  return NextResponse.json({ ready: true, oldRead: a.count ?? 0, passive: b.count ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await member();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`notif-cleanup:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { kind?: string } | null;
  const kind = body?.kind === "old_read" || body?.kind === "passive" ? body.kind : null;
  if (!kind) return NextResponse.json({ error: "Choose a cleanup." }, { status: 400 });
  const db = createAdminClient();
  if (!(await hasActivityColumns(db))) return NextResponse.json({ error: "Cleanup arrives with the next update." }, { status: 503 });
  const { error } = await scoped(db, user.id, kind, false);
  if (error) return NextResponse.json({ error: "Couldn't tidy up." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

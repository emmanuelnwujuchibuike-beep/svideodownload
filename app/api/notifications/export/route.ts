import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EXPORT_ROWS = 10_000;

/**
 * GET /api/notifications/export — Part 8 privacy control ("Export
 * Notification Data"). Returns the RAW rows the user owns (RLS-scoped —
 * the request-scoped client, not the admin one, so this can never leak
 * another user's data even if the query itself had a bug), as a downloadable
 * JSON file. Deliberately the raw stored shape (id/type/actor_id/post_id/
 * conversation_id/read/created_at), not the display-enriched version
 * (actor name/avatar, post title) the Notification Center shows — an
 * export is "here's the data we hold on you," not a rendered view.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await trackLimiter.limit(`notif-export:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, actor_id, post_id, conversation_id, read, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(MAX_EXPORT_ROWS);
  if (error) return NextResponse.json({ error: "Couldn't export." }, { status: 500 });

  const payload = { exportedAt: new Date().toISOString(), userId: user.id, count: data?.length ?? 0, notifications: data ?? [] };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="frenz-notifications-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}

import { NextResponse } from "next/server";

import { smartCategoryOf, type SmartCategory } from "@/lib/notifications/smart-category";
import { suggestRules } from "@/lib/notifications/suggestions";
import { categoryForType, type NotificationType } from "@/lib/platform/notifications-registry";
import { getNotificationSettings } from "@/lib/social/notification-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — Suggested rules (Feature 20 Part 5): the member's own last 7 days counted by
 * smart group, run through `suggestRules`. Read only when the Control Center asks
 * (one tap on "Suggest rules"), never on a timer. Paginated: a busy week passes
 * PostgREST's silent 1000-row ceiling.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = createAdminClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [settings, read] = await Promise.all([
    getNotificationSettings(user.id),
    paginatedSelect<{ type: string }>((from, to) => db.from("notifications").select("type").eq("user_id", user.id).gte("created_at", since).order("created_at", { ascending: false }).range(from, to), 5000),
  ]);
  const counts: Partial<Record<SmartCategory, number>> = {};
  for (const r of read.rows) {
    const t = r.type as NotificationType;
    const g = smartCategoryOf(t, categoryForType(t));
    counts[g] = (counts[g] ?? 0) + 1;
  }
  return NextResponse.json({ suggestions: suggestRules(counts, settings.rules), week: read.rows.length }, { headers: { "Cache-Control": "private, no-store" } });
}

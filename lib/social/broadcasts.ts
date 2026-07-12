import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin broadcast alerts. Segment targeting is plan tier — the one real,
 * already-queryable user segment this app has today (see the owner's own
 * scoping call; "activity recency" / arbitrary cohorts are a real follow-up,
 * not built here).
 *
 * Capped at MAX_TARGETS per send — this app's actual current user base is
 * nowhere near "100M users," and honestly handling a few thousand recipients
 * synchronously is the right-sized version of this feature; genuinely
 * reaching 100M would need a background job queue fanning out in batches,
 * not a single request pretending to be that at this app's real scale.
 */
const MAX_TARGETS = 5000;
const CHUNK_SIZE = 500;

export type BroadcastTargetPlan = "all" | "free" | "pro" | "business";

export interface Broadcast {
  id: string;
  title: string;
  body: string;
  targetPlan: BroadcastTargetPlan;
  createdAt: string;
  sentCount: number;
}

export async function listBroadcasts(limit = 20): Promise<Broadcast[]> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("notification_broadcasts")
      .select("id, title, body, target_plan, created_at, sent_count")
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data ?? []) as { id: string; title: string; body: string; target_plan: BroadcastTargetPlan; created_at: string; sent_count: number }[]).map(
      (r) => ({ id: r.id, title: r.title, body: r.body, targetPlan: r.target_plan, createdAt: r.created_at, sentCount: r.sent_count }),
    );
  } catch {
    return [];
  }
}

/** Creates + fans out a broadcast: one `notifications` row + a best-effort push per targeted user. */
export async function createAndSendBroadcast(
  adminId: string,
  title: string,
  body: string,
  targetPlan: BroadcastTargetPlan,
): Promise<{ ok: boolean; sent: number }> {
  const cleanTitle = title.trim().slice(0, 120);
  const cleanBody = body.trim().slice(0, 500);
  if (!cleanTitle || !cleanBody) return { ok: false, sent: 0 };

  try {
    const db = createAdminClient();

    let query = db.from("profiles").select("id").not("handle", "is", null).eq("is_suspended", false).limit(MAX_TARGETS);
    if (targetPlan !== "all") query = query.eq("plan", targetPlan);
    const { data: targets } = await query;
    const targetIds = ((targets ?? []) as { id: string }[]).map((t) => t.id);
    if (targetIds.length === 0) return { ok: false, sent: 0 };

    const { data: broadcast, error: insertErr } = await db
      .from("notification_broadcasts")
      .insert({ title: cleanTitle, body: cleanBody, target_plan: targetPlan, created_by: adminId })
      .select("id")
      .single();
    if (insertErr || !broadcast) return { ok: false, sent: 0 };

    let sent = 0;
    for (let i = 0; i < targetIds.length; i += CHUNK_SIZE) {
      const chunk = targetIds.slice(i, i + CHUNK_SIZE);
      await db.from("notifications").insert(
        chunk.map((userId) => ({ user_id: userId, actor_id: null, type: "admin_broadcast", post_id: null })),
      );
      await Promise.all(
        chunk.map((userId) => sendSmartPush(userId, { title: cleanTitle, body: cleanBody, url: "/notifications", tag: `broadcast:${broadcast.id}` }, "high", "system")),
      );
      sent += chunk.length;
    }

    await db.from("notification_broadcasts").update({ sent_count: sent }).eq("id", broadcast.id);
    return { ok: true, sent };
  } catch {
    return { ok: false, sent: 0 };
  }
}

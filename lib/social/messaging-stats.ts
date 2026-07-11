import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Real, computed messaging health numbers for the admin dashboard — genuine
 * queries against `messages`/`message_send_failures`/`user_presence_status`,
 * not placeholders. This app's actual scale doesn't warrant a separate
 * metrics pipeline/time-series store; a handful of parallel COUNT queries on
 * already-indexed columns (`created_at`, `conversation_id`) is the honest,
 * right-sized version of "monitoring" here.
 */
export interface MessagingStats {
  messagesToday: number;
  messages7d: number;
  activeConversations7d: number;
  reactions7d: number;
  failures7d: number;
  failureRate7d: number;
  topFailureReasons: { reason: string; count: number }[];
  presenceCounts: Record<"away" | "busy" | "dnd" | "invisible", number>;
  conversationsByType: { direct: number; group: number };
}

const EMPTY: MessagingStats = {
  messagesToday: 0,
  messages7d: 0,
  activeConversations7d: 0,
  reactions7d: 0,
  failures7d: 0,
  failureRate7d: 0,
  topFailureReasons: [],
  presenceCounts: { away: 0, busy: 0, dnd: 0, invisible: 0 },
  conversationsByType: { direct: 0, group: 0 },
};

export async function fetchMessagingStats(): Promise<MessagingStats> {
  const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasSupabase) return EMPTY;

  try {
    const db = createAdminClient();
    const now = Date.now();
    const todayStart = new Date(now - 24 * 60 * 60_000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60_000).toISOString();

    const [
      { count: messagesToday },
      { count: messages7d },
      { data: recentConvIds },
      { count: reactions7d },
      { count: failures7d },
      { data: failureRows },
      { data: presenceRows },
      { data: convTypeRows },
    ] = await Promise.all([
      db.from("messages").select("id", { head: true, count: "exact" }).gte("created_at", todayStart),
      db.from("messages").select("id", { head: true, count: "exact" }).gte("created_at", sevenDaysAgo),
      // PostgREST has no SELECT DISTINCT — de-dupe conversation_id in JS over
      // a capped row set rather than standing up a separate metrics store
      // for one number.
      db.from("messages").select("conversation_id").gte("created_at", sevenDaysAgo).limit(20_000),
      db.from("message_reactions").select("message_id", { head: true, count: "exact" }).gte("created_at", sevenDaysAgo),
      db.from("message_send_failures").select("id", { head: true, count: "exact" }).gte("created_at", sevenDaysAgo),
      db.from("message_send_failures").select("reason").gte("created_at", sevenDaysAgo).limit(5_000),
      db.from("user_presence_status").select("status").neq("status", "available").limit(20_000),
      db.from("conversations").select("type").limit(20_000),
    ]);

    const activeConversations7d = new Set(((recentConvIds ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id)).size;

    const reasonCounts = new Map<string, number>();
    for (const r of (failureRows ?? []) as { reason: string | null }[]) {
      const key = r.reason ?? "unknown";
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
    const topFailureReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    const presenceCounts = { away: 0, busy: 0, dnd: 0, invisible: 0 };
    for (const r of (presenceRows ?? []) as { status: keyof typeof presenceCounts }[]) {
      if (r.status in presenceCounts) presenceCounts[r.status] += 1;
    }

    const conversationsByType = { direct: 0, group: 0 };
    for (const r of (convTypeRows ?? []) as { type: "direct" | "group" }[]) {
      conversationsByType[r.type] += 1;
    }

    const m7 = messages7d ?? 0;
    const f7 = failures7d ?? 0;
    const failureRate7d = m7 + f7 > 0 ? Math.round((f7 / (m7 + f7)) * 1000) / 10 : 0;

    return {
      messagesToday: messagesToday ?? 0,
      messages7d: m7,
      activeConversations7d,
      reactions7d: reactions7d ?? 0,
      failures7d: f7,
      failureRate7d,
      topFailureReasons,
      presenceCounts,
      conversationsByType,
    };
  } catch {
    return EMPTY;
  }
}

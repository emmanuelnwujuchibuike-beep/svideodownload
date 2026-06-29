import { createAdminClient } from "@/lib/supabase/admin";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type NotificationType = "follow" | "like" | "comment";

export interface NotificationActor {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  read: boolean;
  createdAt: string;
  actor: NotificationActor | null;
  postId: string | null;
  postTitle: string | null;
}

interface Row {
  id: string;
  actor_id: string | null;
  type: NotificationType;
  post_id: string | null;
  read: boolean;
  created_at: string;
}

export interface NotificationsResult {
  items: NotificationItem[];
  unread: number;
}

/** A user's recent notifications + unread count. Reads only — filtered to the
 *  recipient, so the service role is safe here. */
export async function listNotifications(userId: string, limit = 20): Promise<NotificationsResult> {
  if (!hasSupabase) return { items: [], unread: 0 };
  try {
    const db = createAdminClient();
    const [{ data }, { count }] = await Promise.all([
      db
        .from("notifications")
        .select("id, actor_id, type, post_id, read, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit),
      db
        .from("notifications")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", userId)
        .eq("read", false),
    ]);

    const rows = (data as Row[]) ?? [];
    if (rows.length === 0) return { items: [], unread: count ?? 0 };

    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean) as string[])];
    const postIds = [...new Set(rows.map((r) => r.post_id).filter(Boolean) as string[])];
    const [{ data: profs }, { data: posts }] = await Promise.all([
      actorIds.length
        ? db.from("profiles").select("id, handle, display_name, avatar_url").in("id", actorIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      postIds.length
        ? db.from("posts").select("id, title").in("id", postIds)
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    ]);

    const actorById = new Map<string, NotificationActor>();
    for (const p of (profs ?? []) as Record<string, unknown>[]) {
      if (!p.handle) continue;
      actorById.set(p.id as string, {
        handle: p.handle as string,
        displayName: (p.display_name as string) || `@${p.handle as string}`,
        avatarUrl: (p.avatar_url as string) ?? null,
      });
    }
    const titleById = new Map(((posts ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));

    const items: NotificationItem[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      read: r.read,
      createdAt: r.created_at,
      actor: r.actor_id ? actorById.get(r.actor_id) ?? null : null,
      postId: r.post_id,
      postTitle: r.post_id ? titleById.get(r.post_id) ?? null : null,
    }));

    return { items, unread: count ?? 0 };
  } catch {
    return { items: [], unread: 0 };
  }
}

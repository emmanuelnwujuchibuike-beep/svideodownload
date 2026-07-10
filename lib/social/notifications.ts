import { createAdminClient } from "@/lib/supabase/admin";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Notification types the app can store. Kept in sync with the DB check constraint
 * (migration 0018). New product areas add types here + a category mapping below.
 */
export type NotificationType =
  | "follow"
  | "like"
  | "love"
  | "comment"
  | "reply"
  | "mention"
  | "tag"
  | "quote"
  | "repost"
  | "repost_engagement"
  | "share"
  | "save"
  | "profile_view"
  | "invite"
  | "milestone"
  | "friend_request"
  | "friend_accepted"
  | "friend_reminder"
  | "download_complete"
  | "download_failed"
  | "download_ready"
  | "processing_finished"
  | "community_invite"
  | "community_accepted"
  | "community_announcement"
  | "community_event"
  | "news_breaking"
  | "news_trending"
  | "news_following"
  | "news_recommended"
  | "subscription_activated"
  | "payment_successful"
  | "renewal_reminder"
  | "premium_expiring"
  | "security_login"
  | "security_new_device"
  | "security_password"
  | "security_2fa"
  | "security_suspicious"
  | "security_recovery"
  | "system";

/** Notification Center tab categories. */
export type NotificationCategory =
  | "social"
  | "downloads"
  | "community"
  | "news"
  | "premium"
  | "security"
  | "system";

const CATEGORY_BY_TYPE: Partial<Record<NotificationType, NotificationCategory>> = {
  follow: "social",
  like: "social",
  love: "social",
  comment: "social",
  reply: "social",
  mention: "social",
  tag: "social",
  quote: "social",
  repost: "social",
  repost_engagement: "social",
  share: "social",
  save: "social",
  profile_view: "social",
  invite: "social",
  milestone: "social",
  friend_request: "social",
  friend_accepted: "social",
  friend_reminder: "social",
  download_complete: "downloads",
  download_failed: "downloads",
  download_ready: "downloads",
  processing_finished: "downloads",
  community_invite: "community",
  community_accepted: "community",
  community_announcement: "community",
  community_event: "community",
  news_breaking: "news",
  news_trending: "news",
  news_following: "news",
  news_recommended: "news",
  subscription_activated: "premium",
  payment_successful: "premium",
  renewal_reminder: "premium",
  premium_expiring: "premium",
  security_login: "security",
  security_new_device: "security",
  security_password: "security",
  security_2fa: "security",
  security_suspicious: "security",
  security_recovery: "security",
};

export function categoryForType(type: NotificationType): NotificationCategory {
  return CATEGORY_BY_TYPE[type] ?? "system";
}

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

/** Hydrate raw rows with actor profile + post title. */
async function enrichRows(db: ReturnType<typeof createAdminClient>, rows: Row[]): Promise<NotificationItem[]> {
  if (rows.length === 0) return [];
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

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    read: r.read,
    createdAt: r.created_at,
    actor: r.actor_id ? actorById.get(r.actor_id) ?? null : null,
    postId: r.post_id,
    postTitle: r.post_id ? titleById.get(r.post_id) ?? null : null,
  }));
}

/** A user's recent notifications + unread count (flat — powers the topbar bell). */
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
    const items = await enrichRows(db, (data as Row[]) ?? []);
    return { items, unread: count ?? 0 };
  } catch {
    return { items: [], unread: 0 };
  }
}

/**
 * A smart-grouped notification: many same-kind events on the same target collapse
 * into one ("John, Emma and 27 others liked your post"). `actors` holds up to 3 for
 * display; `othersCount` is the rest. `notificationIds` lets the UI mark-read/delete
 * the whole group at once.
 */
export interface NotificationGroup {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  read: boolean;
  createdAt: string;
  actors: NotificationActor[];
  othersCount: number;
  totalActors: number;
  postId: string | null;
  postTitle: string | null;
  notificationIds: string[];
}

export interface GroupedNotificationsResult {
  groups: NotificationGroup[];
  unread: number;
}

// Post-scoped actions collapse per post; relationship signals collapse together.
const GROUP_BY_POST = new Set<NotificationType>(["like", "love", "comment", "reply", "save", "repost", "repost_engagement", "share", "quote"]);
const GROUP_TOGETHER = new Set<NotificationType>(["follow", "profile_view"]);

function groupKey(it: NotificationItem): string {
  if (GROUP_BY_POST.has(it.type) && it.postId) return `${it.type}:${it.postId}`;
  if (GROUP_TOGETHER.has(it.type)) return it.type;
  return `${it.type}:${it.id}`;
}

/**
 * Grouped, prioritized notifications for the Notification Center. Over-fetches then
 * collapses spammy duplicates so the list stays calm and premium. Rows come newest
 * first, so the first row seen for a group sets its (most-recent) timestamp.
 */
export async function listGroupedNotifications(userId: string, limit = 60): Promise<GroupedNotificationsResult> {
  if (!hasSupabase) return { groups: [], unread: 0 };
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
    const items = await enrichRows(db, (data as Row[]) ?? []);

    const byKey = new Map<string, NotificationGroup>();
    const seenActors = new Map<string, Set<string>>();
    const order: string[] = [];

    for (const it of items) {
      const key = groupKey(it);
      let g = byKey.get(key);
      if (!g) {
        g = {
          id: key,
          type: it.type,
          category: categoryForType(it.type),
          read: true,
          createdAt: it.createdAt, // newest first, so this is the latest
          actors: [],
          othersCount: 0,
          totalActors: 0,
          postId: it.postId,
          postTitle: it.postTitle,
          notificationIds: [],
        };
        byKey.set(key, g);
        seenActors.set(key, new Set());
        order.push(key);
      }
      g.notificationIds.push(it.id);
      if (!it.read) g.read = false;
      const actors = seenActors.get(key)!;
      if (it.actor && !actors.has(it.actor.handle)) {
        actors.add(it.actor.handle);
        g.totalActors += 1;
        if (g.actors.length < 3) g.actors.push(it.actor);
      }
    }

    const groups = order.map((k) => {
      const g = byKey.get(k)!;
      g.othersCount = Math.max(0, g.totalActors - g.actors.length);
      return g;
    });

    return { groups, unread: count ?? 0 };
  } catch {
    return { groups: [], unread: 0 };
  }
}

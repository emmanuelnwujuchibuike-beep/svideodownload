import { hrefForNotification } from "@/lib/notifications/destinations";
import { defaultPriorityFor } from "@/lib/notifications/priority";
import type { DeliveryDecision } from "@/lib/notifications/explain";
import { parseActivityQuery } from "@/lib/notifications/search";
import { getNotificationSettings, mutedTypesFor } from "@/lib/social/notification-settings";
import { createAdminClient } from "@/lib/supabase/admin";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Notification types, categories, the category map, the grouping rules and the
 * badge-exclusion list are all declared in the Notification Registry
 * (`lib/platform/notifications-registry.ts`) — the single source. Imported for
 * local use and re-exported so every existing importer of these names is unchanged.
 * The DB-side `type` check constraint (migrations 0018/0059) mirrors the registry.
 */
import {
  badgeExcludedTypes,
  CATEGORY_BY_TYPE,
  categoryForType,
  type NotificationCategory,
  type NotificationType,
  typesGroupedBy,
} from "@/lib/platform/notifications-registry";

export { CATEGORY_BY_TYPE, categoryForType };
export type { NotificationCategory, NotificationType };

export interface NotificationActor {
  /** The actor's user id — powers direct actions on a notification card
   *  (Accept/Decline a friend request, Follow back), added 2026-07-12. */
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/** An admin broadcast / AD's own content, carried on the notification's `data`
 *  so the in-app card shows the real ad + a "Sponsored" label. */
export interface NotificationBroadcast {
  title: string;
  body: string;
  sponsored: boolean;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  read: boolean;
  createdAt: string;
  actor: NotificationActor | null;
  postId: string | null;
  postTitle: string | null;
  /**
   * Premium brief (2026-10-12): a small picture of what it's about — the post's own
   * poster or the wallpaper's thumbnail (never the full media). Null when there is none.
   */
  thumbUrl: string | null;
  /** The post was deleted, taken down or made private — the card says so instead of linking to a 404. */
  postGone: boolean;
  /** A comment / reply notification's own words, one short line (hidden or removed comments never) */
  commentText: string | null;
  conversationId: string | null;
  /** Present on admin_broadcast rows — the ad/announcement content + sponsored flag. */
  broadcast: NotificationBroadcast | null;
  /**
   * The push's own text, for notifications that have no ACTOR and would
   * otherwise render only the type's generic label ("System", "Download
   * failed"). Every push now stores what it actually said — see
   * `recordInApp` in lib/notifications/smart-delivery.ts.
   */
  content: { title: string; body: string } | null;
  /**
   * Where tapping it goes. Resolved from the notification's own `data.url`
   * when it has one, otherwise from its type — never null, so every card in
   * the Notification Center is a link (owner, 2026-08-26).
   */
  href: string;
  /** Feature 20 (0233) — false/null before the migration runs. */
  pinned: boolean;
  archived: boolean;
  /** critical | high | medium | low — the same table the push path uses (lib/notifications/priority.ts). */
  priority: "critical" | "high" | "medium" | "low";
  /** What the Attention Engine decided for its push; null when no decision was recorded. */
  delivery: DeliveryDecision | null;
  deliveryReason: string | null;
  /** Feature 20 Part 3 (0234): private labels, and the notification's own history */
  labels: string[];
  readAt: string | null;
  pinnedAt: string | null;
  archivedAt: string | null;
}

interface Row {
  comment_id?: string | null;
  labels?: string[] | null;
  read_at?: string | null;
  pinned_at?: string | null;
  archived_at?: string | null;
  delivery?: string | null;
  delivery_reason?: string | null;
  id: string;
  actor_id: string | null;
  type: NotificationType;
  post_id: string | null;
  conversation_id: string | null;
  read: boolean;
  created_at: string;
  data?: { title?: string; body?: string; sponsored?: boolean; url?: string | null } | null;
}

// `notifications.data` arrives with migration 0094 — probe once per server
// instance and only select it when present, so a lagging migration never breaks
// the whole notifications read.
let dataColumnKnown: boolean | null = null;
// 0233 (Feature 20): pinned / archived / delivery — same once-per-instance probe, same reason
let activityColumnsKnown: boolean | null = null;
let inboxColumnsKnown: boolean | null = null;
async function selectCols(db: ReturnType<typeof createAdminClient>): Promise<string> {
  const cols = "id, actor_id, type, post_id, comment_id, conversation_id, read, created_at";
  if (dataColumnKnown === null) {
    const { error } = await db.from("notifications").select("data").limit(1);
    dataColumnKnown = !error;
  }
  await hasActivityColumns(db);
  await hasInboxColumns(db);
  return `${cols}${dataColumnKnown ? ", data" : ""}${activityColumnsKnown ? ", pinned_at, archived_at, delivery, delivery_reason" : ""}${inboxColumnsKnown ? ", labels, read_at" : ""}`;
}

/** Are 0234's columns (labels, read_at) live? Probed once per server instance. */
export async function hasInboxColumns(db: ReturnType<typeof createAdminClient>): Promise<boolean> {
  if (inboxColumnsKnown === null) {
    const { error } = await db.from("notifications").select("labels, read_at").limit(1);
    inboxColumnsKnown = !error;
  }
  return inboxColumnsKnown;
}

/** Are 0233's columns live? Probed once per server instance. */
export async function hasActivityColumns(db: ReturnType<typeof createAdminClient>): Promise<boolean> {
  if (activityColumnsKnown === null) {
    const { error } = await db.from("notifications").select("pinned_at, archived_at, delivery, delivery_reason").limit(1);
    activityColumnsKnown = !error;
  }
  return activityColumnsKnown;
}

const DECISIONS = new Set(["pushed", "held", "in_app"]);
function deliveryOf(v: string | null | undefined): DeliveryDecision | null {
  if (!v || !DECISIONS.has(v)) return null;
  return v === "pushed" ? "push" : (v as DeliveryDecision);
}

/**
 * The stored push text, for non-broadcast rows.
 *
 * `admin_broadcast` keeps its own `broadcast` field — it renders differently
 * (an "Ad"/"News" label) and has its own `sponsored` flag, so folding the two
 * together would either lose that label or put it on every system notification.
 */
function contentOf(r: Row): { title: string; body: string } | null {
  if (r.type === "admin_broadcast") return null;
  if (!r.data?.title) return null;
  return { title: r.data.title, body: r.data.body ?? "" };
}

function broadcastOf(r: Row): NotificationBroadcast | null {
  if (r.type !== "admin_broadcast" || !r.data || !r.data.title) return null;
  return { title: r.data.title, body: r.data.body ?? "", sponsored: !!r.data.sponsored };
}

/** Message notifications aren't deduped in the DB (every send is a genuine new event — see 0042's own comment); the bell's numeric badge excludes them so a chat burst doesn't drown out real social notifications, while the dropdown LIST still shows them (see notification-bell.tsx). */
const MESSAGE_TYPES: NotificationType[] = badgeExcludedTypes();

export interface NotificationsResult {
  items: NotificationItem[];
  unread: number;
}

/** Hydrate raw rows with actor profile + post title. */
/** "/wallpapers?w=<uuid>" → the wallpaper id a notification is about. */
const WALLPAPER_IN_URL = /[?&]w=([0-9a-f-]{36})/i;
const httpsOnly = (u: unknown): string | null => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

async function enrichRows(db: ReturnType<typeof createAdminClient>, rows: Row[], recipientId: string): Promise<NotificationItem[]> {
  if (rows.length === 0) return [];
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean) as string[])];
  const postIds = [...new Set(rows.map((r) => r.post_id).filter(Boolean) as string[])];
  const commentIds = [...new Set(rows.map((r) => (r.type === "comment" || r.type === "reply" ? r.comment_id : null)).filter(Boolean) as string[])];
  const wallpaperIds = [...new Set(rows.map((r) => (r.type.startsWith("wallpaper_") ? WALLPAPER_IN_URL.exec(r.data?.url ?? "")?.[1] : null)).filter(Boolean) as string[])];
  // one read per kind for the whole page — never one per notification
  const [{ data: profs }, { data: posts }, { data: walls }, { data: comments }] = await Promise.all([
    actorIds.length
      ? db.from("profiles").select("id, handle, display_name, avatar_url").in("id", actorIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    postIds.length
      ? db.from("posts").select("id, title, thumbnail_url, status, visibility, publisher_id").in("id", postIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    wallpaperIds.length ? db.from("wallpapers").select("id, thumb_url").in("id", wallpaperIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    commentIds.length ? db.from("post_comments").select("id, body, status").in("id", commentIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const commentById = new Map(((comments ?? []) as { id: string; body: string; status: string }[]).filter((c) => c.status === "visible").map((c) => [c.id, c.body.replace(/\s+/g, " ").trim().slice(0, 90)]));

  const actorById = new Map<string, NotificationActor>();
  for (const p of (profs ?? []) as Record<string, unknown>[]) {
    if (!p.handle) continue;
    actorById.set(p.id as string, {
      id: p.id as string,
      handle: p.handle as string,
      displayName: (p.display_name as string) || `@${p.handle as string}`,
      avatarUrl: (p.avatar_url as string) ?? null,
    });
  }
  type PostRow = { id: string; title: string | null; thumbnail_url: string | null; status: string; visibility: string; publisher_id: string };
  const postById = new Map(((posts ?? []) as PostRow[]).map((p) => [p.id, p]));
  // a post this member may no longer see is "gone" to them: removed, under review, or made private by someone else
  const visible = (p: PostRow | undefined) => !!p && p.status === "published" && (p.visibility !== "private" || p.publisher_id === recipientId);
  const wallThumb = new Map(((walls ?? []) as { id: string; thumb_url: string | null }[]).map((w) => [w.id, httpsOnly(w.thumb_url)]));

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    read: r.read,
    createdAt: r.created_at,
    actor: r.actor_id ? actorById.get(r.actor_id) ?? null : null,
    postId: r.post_id,
    postTitle: r.post_id && visible(postById.get(r.post_id)) ? (postById.get(r.post_id)?.title ?? null) : null,
    thumbUrl: r.post_id
      ? visible(postById.get(r.post_id))
        ? httpsOnly(postById.get(r.post_id)?.thumbnail_url)
        : null
      : r.type.startsWith("wallpaper_")
        ? (wallThumb.get(WALLPAPER_IN_URL.exec(r.data?.url ?? "")?.[1] ?? "") ?? null)
        : null,
    postGone: !!r.post_id && !visible(postById.get(r.post_id)),
    commentText: r.comment_id && visible(postById.get(r.post_id ?? "")) ? (commentById.get(r.comment_id) ?? null) : null,
    conversationId: r.conversation_id,
    broadcast: broadcastOf(r),
    content: contentOf(r),
    href: hrefForNotification(r.type, r.data?.url),
    pinned: !!r.pinned_at,
    archived: !!r.archived_at,
    priority: defaultPriorityFor(r.type),
    delivery: deliveryOf(r.delivery),
    deliveryReason: r.delivery_reason ?? null,
    labels: Array.isArray(r.labels) ? r.labels : [],
    readAt: r.read_at ?? null,
    pinnedAt: r.pinned_at ?? null,
    archivedAt: r.archived_at ?? null,
  }));
}

/**
 * A user's recent notifications + unread count (flat — powers the topbar bell).
 * The `unread` count deliberately excludes message/message_reaction — those
 * already have their own dedicated inbox badge (see features/social/inbox.ts),
 * and including them here would double-count AND let a chat burst drown out
 * real social notifications on the bell. The returned `items` list still
 * includes them, so they're visible in the dropdown history.
 */
export async function listNotifications(userId: string, limit = 20): Promise<NotificationsResult> {
  if (!hasSupabase) return { items: [], unread: 0 };
  try {
    const db = createAdminClient();
    const settings = await getNotificationSettings(userId);
    if (!settings.masterEnabled || !settings.inAppEnabled) return { items: [], unread: 0 };
    // Part 6: a category the viewer disabled in-app is excluded from both the
    // list AND the unread count — "Disable" means genuinely not seeing it,
    // not just hiding a badge while the row still shows up in the dropdown.
    const muted = mutedTypesFor(settings, CATEGORY_BY_TYPE);
    const excluded = [...new Set([...MESSAGE_TYPES, ...muted])];
    let listQuery = db
      .from("notifications")
      .select(await selectCols(db))
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    let countQuery = db
      .from("notifications")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("read", false);
    if (muted.length > 0) listQuery = listQuery.not("type", "in", `(${muted.join(",")})`);
    countQuery = countQuery.not("type", "in", `(${excluded.join(",")})`);
    if (await hasActivityColumns(db)) {
      listQuery = listQuery.is("archived_at", null);
      countQuery = countQuery.is("archived_at", null);
    }
    const [{ data }, { count }] = await Promise.all([listQuery, countQuery]);
    const items = await enrichRows(db, (data as unknown as Row[]) ?? [], userId);
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
  thumbUrl: string | null;
  postGone: boolean;
  commentText: string | null;
  conversationId: string | null;
  notificationIds: string[];
  /** Present on admin_broadcast groups — the ad/announcement content. */
  broadcast: NotificationBroadcast | null;
  /** The stored push text, for actor-less notifications. See NotificationItem. */
  content: { title: string; body: string } | null;
  /** Where tapping the card goes — never null. See NotificationItem. */
  href: string;
  /** Feature 20: any member pinned / every member archived */
  pinned: boolean;
  archived: boolean;
  /** the highest priority among the members */
  priority: NotificationItem["priority"];
  /** the NEWEST member's delivery decision and reason ("Why this?") */
  delivery: NotificationItem["delivery"];
  deliveryReason: string | null;
  /** every label on any member; the newest member's history */
  labels: string[];
  readAt: string | null;
  pinnedAt: string | null;
  archivedAt: string | null;
}

export interface GroupedNotificationsResult {
  groups: NotificationGroup[];
  unread: number;
  /** 0233 is live — the Activity Center offers Pin / Archive only then */
  activity?: boolean;
  /** 0234 is live — labels and read history */
  inbox?: boolean;
  /** a search over the whole history ran (archived included) */
  searched?: boolean;
  /** pagination (premium brief): the created_at to ask "older than" next, or null when this was the last page */
  nextBefore?: string | null;
}

/** Inbox = everything not archived (the default). Archived = only what the member put away. */
export type ActivityView = "inbox" | "archived";
const RANK = { critical: 3, high: 2, medium: 1, low: 0 } as const;

// Post-scoped actions collapse per post; relationship signals collapse together;
// message notifications collapse per conversation (many new messages from the
// same thread → one card, "Sam sent you 5 messages", not five separate rows).
const GROUP_BY_POST = new Set<NotificationType>(typesGroupedBy("post"));
const GROUP_TOGETHER = new Set<NotificationType>(typesGroupedBy("together"));
const GROUP_BY_CONVERSATION = new Set<NotificationType>(typesGroupedBy("conversation"));

function groupKey(it: NotificationItem): string {
  if (GROUP_BY_POST.has(it.type) && it.postId) return `${it.type}:${it.postId}`;
  if (GROUP_BY_CONVERSATION.has(it.type) && it.conversationId) return `${it.type}:${it.conversationId}`;
  if (GROUP_TOGETHER.has(it.type)) return it.type;
  return `${it.type}:${it.id}`;
}

/**
 * Grouped, prioritized notifications for the Notification Center. Over-fetches then
 * collapses spammy duplicates so the list stays calm and premium. Rows come newest
 * first, so the first row seen for a group sets its (most-recent) timestamp.
 */
export async function listGroupedNotifications(userId: string, limit = 60, view: ActivityView = "inbox", search?: string | null, before?: string | null): Promise<GroupedNotificationsResult> {
  if (!hasSupabase) return { groups: [], unread: 0 };
  try {
    const db = createAdminClient();
    const settings = await getNotificationSettings(userId);
    if (!settings.masterEnabled || !settings.inAppEnabled) return { groups: [], unread: 0 };
    const muted = mutedTypesFor(settings, CATEGORY_BY_TYPE);
    let listQuery = db
      .from("notifications")
      .select(await selectCols(db))
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    let countQuery = db
      .from("notifications")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("read", false);
    if (muted.length > 0) {
      listQuery = listQuery.not("type", "in", `(${muted.join(",")})`);
      countQuery = countQuery.not("type", "in", `(${muted.join(",")})`);
    }
    // older pages: a cursor on created_at (indexed with user_id), never an offset
    if (before && !Number.isNaN(Date.parse(before))) listQuery = listQuery.lt("created_at", new Date(before).toISOString());
    const activity = await hasActivityColumns(db);
    const inbox = await hasInboxColumns(db);
    const q = search?.trim() ? parseActivityQuery(search.slice(0, 200), new Date()) : null;
    if (activity) {
      // the unread count is always the inbox's; the list follows the view — a search covers everything, archive included
      countQuery = countQuery.is("archived_at", null);
      if (!q) listQuery = view === "archived" ? listQuery.not("archived_at", "is", null) : listQuery.is("archived_at", null);
    } else if (view === "archived" && !q) {
      return { groups: [], unread: 0, activity };
    }
    if (q) {
      /*
        Feature 20 Part 3 — the Universal Inbox search, over the whole history. The same
        parse the Activity Center shows as chips; every value below comes from the parser's
        own vocabulary or is reduced to letters and digits before it reaches a filter.
      */
      const types = [...new Set([...q.types, ...(Object.entries(CATEGORY_BY_TYPE) as [NotificationType, NotificationCategory][]).filter(([, c]) => q.categories.includes(c)).map(([t]) => t)])];
      if (q.types.length || q.categories.length) listQuery = types.length ? listQuery.in("type", types) : listQuery.eq("id", "00000000-0000-0000-0000-000000000000");
      if (q.since) listQuery = listQuery.gte("created_at", q.since.toISOString());
      if (q.until) listQuery = listQuery.lt("created_at", q.until.toISOString());
      if (q.unread) listQuery = listQuery.eq("read", false);
      if (q.pinned && activity) listQuery = listQuery.not("pinned_at", "is", null);
      if (q.held && activity) listQuery = listQuery.eq("delivery", "held");
      if (q.from) {
        const who = q.from.replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 40);
        const { data: people } = who ? await db.from("profiles").select("id").or(`handle.ilike.%${who}%,display_name.ilike.%${who}%`).limit(25) : { data: [] };
        const ids = ((people ?? []) as { id: string }[]).map((x) => x.id);
        if (!ids.length) return { groups: [], unread: 0, activity, inbox, searched: true };
        listQuery = listQuery.in("actor_id", ids);
      }
      for (const raw of q.words.slice(0, 4)) {
        const w = raw.replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 40);
        if (!w) continue;
        listQuery = listQuery.or(`data->>title.ilike.%${w}%,data->>body.ilike.%${w}%${inbox ? `,labels.cs.{${w}}` : ""}`);
      }
    }
    const [{ data }, { count }] = await Promise.all([listQuery, countQuery]);
    const raw = (data as unknown as Row[]) ?? [];
    const nextBefore = raw.length >= limit ? (raw[raw.length - 1]?.created_at ?? null) : null;
    const items = await enrichRows(db, raw, userId);

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
          thumbUrl: it.thumbUrl,
          postGone: it.postGone,
          commentText: it.commentText,
          conversationId: it.conversationId,
          notificationIds: [],
          broadcast: it.broadcast,
          content: it.content,
          // The group takes the NEWEST member's destination (rows arrive newest
          // first), so a collapsed group opens the most recent thing in it.
          href: it.href,
          pinned: false,
          archived: it.archived,
          priority: it.priority,
          delivery: it.delivery,
          deliveryReason: it.deliveryReason,
          labels: [],
          readAt: it.readAt,
          pinnedAt: it.pinnedAt,
          archivedAt: it.archivedAt,
        };
        byKey.set(key, g);
        seenActors.set(key, new Set());
        order.push(key);
      }
      g.notificationIds.push(it.id);
      if (!it.read) g.read = false;
      if (it.pinned) g.pinned = true;
      for (const l of it.labels) if (!g.labels.includes(l)) g.labels.push(l);
      if (!it.archived) g.archived = false;
      if (RANK[it.priority] > RANK[g.priority]) g.priority = it.priority;
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

    return { groups, unread: count ?? 0, activity, inbox, searched: !!q, nextBefore };
  } catch {
    return { groups: [], unread: 0 };
  }
}

import type { NotificationItem, NotificationType } from "@/lib/social/notifications";

/**
 * Turns a real notification into a Recent-Activity row for the creator rail.
 * Pure + framework-free so BOTH the server (initial render in the profile page)
 * and the client (live realtime updates in creator-activity.tsx) build rows the
 * exact same way. No fabricated content — every row is a genuine event on the
 * owner's account (a follow, a Wow, a comment, an announcement…).
 */

export interface ActivityRow {
  id: string;
  /** The notification type — the client picks the icon + tint from it. */
  kind: NotificationType | "admin_broadcast";
  text: string;
  time: string;
}

/** Compact "just now / 5m / 3h / 2d / Jul 4" relative time. */
export function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const VERB: Partial<Record<NotificationType, string>> = {
  follow: "started following you",
  like: "Wow'd your post",
  save: "saved your post",
  comment: "commented on your post",
  reply: "replied to your comment",
  repost: "reposted your post",
  mention: "mentioned you",
  friend_request: "sent you a friend request",
  friend_accepted: "accepted your friend request",
  message: "sent you a message",
  message_reaction: "reacted to your message",
};

/** Build a single activity row from a real notification, or null to skip it. */
export function notificationToActivity(n: NotificationItem): ActivityRow | null {
  // An admin broadcast / ad shows its OWN title (never a fake first-person line).
  if (n.type === "admin_broadcast") {
    if (!n.broadcast) return null;
    return {
      id: n.id,
      kind: "admin_broadcast",
      text: `${n.broadcast.sponsored ? "Sponsored · " : ""}${n.broadcast.title}`,
      time: relTime(n.createdAt),
    };
  }
  const who = n.actor?.displayName ?? "Someone";
  const verb = VERB[n.type] ?? "interacted with your profile";
  const suffix = n.postTitle ? ` · ${n.postTitle}` : "";
  return { id: n.id, kind: n.type, text: `${who} ${verb}${suffix}`, time: relTime(n.createdAt) };
}

export function notificationsToActivity(items: NotificationItem[], max = 6): ActivityRow[] {
  const out: ActivityRow[] = [];
  for (const it of items) {
    const row = notificationToActivity(it);
    if (row) out.push(row);
    if (out.length >= max) break;
  }
  return out;
}

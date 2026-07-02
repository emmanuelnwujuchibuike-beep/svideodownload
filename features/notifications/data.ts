"use client";

import type { GroupedNotificationsResult, NotificationItem } from "@/lib/social/notifications";

/**
 * Shared client cache keys + loaders for notifications. The topbar bell reads the
 * flat list; the Notification Center reads the grouped list. Keeping both here lets
 * either surface revalidate the other (e.g. "mark all read" refreshes the bell).
 */
export const NOTIF_KEY = "notifications";
export const NOTIF_GROUPED_KEY = "notifications:grouped";

export interface FlatNotifications {
  items: NotificationItem[];
  unread: number;
}

export async function loadFlatNotifications(): Promise<FlatNotifications> {
  const res = await fetch("/api/notifications");
  if (!res.ok) return { items: [], unread: 0 };
  const d = (await res.json()) as FlatNotifications;
  return { items: d.items ?? [], unread: d.unread ?? 0 };
}

export async function loadGroupedNotifications(): Promise<GroupedNotificationsResult> {
  const res = await fetch("/api/notifications?grouped=1&limit=80");
  if (!res.ok) return { groups: [], unread: 0 };
  const d = (await res.json()) as GroupedNotificationsResult;
  return { groups: d.groups ?? [], unread: d.unread ?? 0 };
}

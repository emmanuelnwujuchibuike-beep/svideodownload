"use client";

import { useQuery } from "@/features/data";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";

/**
 * The small unread dot beside the "Messages" title.
 *
 * Client-side on purpose: it used to be derived from the page's own awaited
 * `listConversations()` result, which meant the TITLE could not render until
 * that query resolved — dragging the whole header (and the profile button next
 * to it) into the page's suspense boundary and behind `loading.tsx`'s skeleton
 * on every re-render. That's the "no object including the profile button at the
 * top of the message page should never reload" report (owner, 2026-07-16).
 *
 * Reading the shared inbox cache instead makes it free: it paints from the
 * last-known value instantly, updates live off the same realtime-backed store
 * the bottom nav's badge already uses, and needs no server data at all.
 */
export function InboxUnreadDot() {
  const { data } = useQuery<Inbox>(INBOX_KEY, loadInbox);
  if (!data?.conversations.some((c) => c.unread)) return null;
  return <span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--brand-purple))]" />;
}

"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";

import { useQuery } from "@/features/data";
import { INBOX_KEY, loadInbox, useInboxRealtime, type Inbox } from "@/features/social/inbox";

/**
 * Topbar messages button with a live unread badge. Cached-first (instant on every
 * page) + realtime, so the count updates the moment a new message lands — no refresh.
 */
export function MessagesBell() {
  const { data } = useQuery<Inbox>(INBOX_KEY, loadInbox);
  useInboxRealtime();
  const unread = data?.unread ?? 0;

  return (
    <Link
      href="/messages"
      aria-label={`Messages${unread > 0 ? ` (${unread} unread)` : ""}`}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-secondary hover:text-foreground"
    >
      <MessageSquare className="h-5 w-5" />
      {unread > 0 ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-background">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

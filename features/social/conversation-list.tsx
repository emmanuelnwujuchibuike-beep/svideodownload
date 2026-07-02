"use client";

import { BadgeCheck } from "lucide-react";
import Link from "next/link";

import { useQuery } from "@/features/data";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";
import type { ConversationSummary } from "@/lib/social/messages";
import { cn } from "@/lib/utils";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Realtime inbox list — seeded server-side (instant paint), then live-updated. */
export function ConversationList({ initial }: { initial: ConversationSummary[] }) {
  // Shares the INBOX_KEY cache with the topbar MessagesBell, which owns the
  // realtime subscription — so this list live-updates without a second channel.
  const { data } = useQuery<Inbox>(INBOX_KEY, loadInbox, {
    initialData: { conversations: initial, unread: initial.filter((c) => c.unread).length },
  });
  const conversations = data?.conversations ?? initial;

  if (conversations.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
        No conversations yet. Open someone&apos;s profile and tap Message to start one.
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft">
      {conversations.map((c) => (
        <li key={c.id} className="border-b border-border/50 last:border-0">
          <Link href={`/messages/${c.id}`} className="flex items-center gap-3 p-3.5 transition hover:bg-secondary/40">
            {c.other.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.other.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-base font-bold text-white">
                {c.other.displayName.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={cn("truncate text-sm", c.unread ? "font-bold" : "font-semibold")}>{c.other.displayName}</span>
                {c.other.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(c.lastAt)}</span>
              </div>
              <p className={cn("mt-0.5 truncate text-sm", c.unread ? "text-foreground" : "text-muted-foreground")}>
                {c.fromMe ? "You: " : ""}
                {c.lastBody ?? "…"}
              </p>
            </div>
            {c.unreadCount > 0 ? (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-1.5 text-[10px] font-bold text-white">
                {c.unreadCount > 99 ? "99+" : c.unreadCount}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

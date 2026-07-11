"use client";

import { BadgeCheck, BellOff, MoreHorizontal, Pin, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { mutate, useQuery } from "@/features/data";
import { usePresence } from "@/features/friends/use-presence";
import { GroupAvatarStack } from "@/features/social/group-avatar-stack";
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

async function setPrefs(conversationId: string, patch: Partial<{ muted: boolean; archived: boolean; pinned: boolean }>): Promise<boolean> {
  try {
    const res = await fetch(`/api/conversations/${conversationId}/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Realtime inbox — seeded server-side (instant paint), then live-updated via the
 * shared INBOX_KEY cache. `variant="pane"` is the Glass Split desktop sidebar:
 * scrolling list with instant search, presence dots, and active-thread highlight.
 */
export function ConversationList({
  initial,
  variant = "page",
}: {
  initial: ConversationSummary[];
  variant?: "page" | "pane";
}) {
  // Live updates come from InboxRealtimeTracker (mounted once in the app
  // shell) revalidating this same shared cache — no second subscription here.
  const { data } = useQuery<Inbox>(INBOX_KEY, loadInbox, {
    initialData: { conversations: initial, unread: initial.filter((c) => c.unread).length },
  });
  const conversations = data?.conversations ?? initial;
  const pathname = usePathname();
  const online = usePresence();
  const [q, setQ] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = conversations.filter((c) => !c.archived);
    if (!query) return base;
    return base.filter((c) => {
      const name = c.type === "group" ? (c.title ?? "") : c.other!.displayName;
      const handle = c.type === "group" ? "" : c.other!.handle;
      return name.toLowerCase().includes(query) || handle.toLowerCase().includes(query);
    });
  }, [conversations, q]);

  const pane = variant === "pane";

  const EMPTY_INBOX: Inbox = { conversations: [], unread: 0 };

  const updatePref = async (id: string, patch: Partial<{ muted: boolean; archived: boolean; pinned: boolean }>) => {
    setOpenMenuId(null);
    mutate<Inbox>(INBOX_KEY, (prev) =>
      prev ? { ...prev, conversations: prev.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : EMPTY_INBOX,
    );
    const ok = await setPrefs(id, patch);
    if (!ok) {
      // Revert on failure.
      mutate<Inbox>(INBOX_KEY, (prev) =>
        prev
          ? {
              ...prev,
              conversations: prev.conversations.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      ...(patch.muted !== undefined ? { muted: !patch.muted } : {}),
                      ...(patch.archived !== undefined ? { archived: !patch.archived } : {}),
                      ...(patch.pinned !== undefined ? { pinned: !patch.pinned } : {}),
                    }
                  : c,
              ),
            }
          : EMPTY_INBOX,
      );
    }
  };

  if (conversations.length === 0) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground", pane && "m-3")}>
        No conversations yet. Open someone&apos;s profile and tap Message to start one.
      </div>
    );
  }

  return (
    <div className={cn(pane && "flex min-h-0 flex-1 flex-col")}>
      {/* Instant search */}
      <label className={cn("relative block", pane ? "mx-3 mb-2" : "mb-3")}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search chats…"
          aria-label="Search conversations"
          className="w-full rounded-xl border border-border/60 bg-background/60 py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-accent/50 focus:ring-2 focus:ring-accent/25"
        />
      </label>

      <ul
        className={cn(
          pane
            ? "min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3"
            : "overflow-hidden rounded-2xl border border-border/50 bg-card shadow-soft ring-1 ring-inset ring-white/[0.03]",
        )}
      >
        {visible.map((c) => {
          const active = pane && pathname === `/messages/${c.id}`;
          const isGroup = c.type === "group";
          const isOnline = !isGroup && online.has(c.other!.id);
          const name = isGroup ? c.title ?? "Group chat" : c.other!.displayName;
          return (
            <li key={c.id} className={cn("group relative", !pane && "border-b border-border/50 last:border-0")}>
              <Link
                href={`/messages/${c.id}`}
                className={cn(
                  "flex items-center gap-3 p-3 transition",
                  pane ? "rounded-2xl" : "p-3.5",
                  active
                    ? "bg-gradient-to-r from-blue-500/[0.10] to-violet-500/[0.10] ring-1 ring-inset ring-violet-500/25"
                    : "hover:bg-secondary/40",
                )}
              >
                <span className="relative shrink-0">
                  {isGroup ? (
                    c.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                    ) : (
                      // The inbox list doesn't fetch per-member avatars (would
                      // add a query per group just for this) — a group without
                      // a custom photo falls back to the "#" placeholder;
                      // GroupAvatarStack's real overlapping-avatars rendering
                      // is used in the thread header, where members[] exists.
                      <GroupAvatarStack avatars={[]} />
                    )
                  ) : c.other!.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.other!.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-base font-bold text-white">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  {isOnline ? (
                    <span aria-label="Online" className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center">
                      <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:hidden" />
                      <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-background" />
                    </span>
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {c.pinned ? <Pin className="h-3 w-3 shrink-0 text-primary" /> : null}
                    <span className={cn("truncate text-sm", c.unread ? "font-bold" : "font-semibold")}>{name}</span>
                    {!isGroup && c.other!.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                    {c.muted ? <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(c.lastAt)}</span>
                  </div>
                  <p className={cn("mt-0.5 truncate text-sm", c.unread ? "text-foreground" : "text-muted-foreground")}>
                    {c.fromMe ? "You: " : ""}
                    {c.lastBody ?? "…"}
                  </p>
                </div>
                {c.unreadCount > 0 && !c.muted ? (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-1.5 text-[10px] font-bold text-white">
                    {c.unreadCount > 99 ? "99+" : c.unreadCount}
                  </span>
                ) : null}
              </Link>

              <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => setOpenMenuId(openMenuId === c.id ? null : c.id)}
                  aria-label="Conversation options"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-card/90 text-muted-foreground shadow-sm transition hover:text-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {openMenuId === c.id ? (
                  <>
                    <button
                      type="button"
                      aria-label="Close menu"
                      onClick={() => setOpenMenuId(null)}
                      className="fixed inset-0 z-40 cursor-default"
                    />
                    <div className="absolute right-0 top-9 z-50 w-40 overflow-hidden rounded-2xl border border-border/70 bg-card py-1 shadow-elevated">
                      <button
                        type="button"
                        onClick={() => updatePref(c.id, { pinned: !c.pinned })}
                        className="flex w-full items-center px-3.5 py-2 text-left text-sm transition hover:bg-secondary"
                      >
                        {c.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        type="button"
                        onClick={() => updatePref(c.id, { muted: !c.muted })}
                        className="flex w-full items-center px-3.5 py-2 text-left text-sm transition hover:bg-secondary"
                      >
                        {c.muted ? "Unmute" : "Mute"}
                      </button>
                      <button
                        type="button"
                        onClick={() => updatePref(c.id, { archived: true })}
                        className="flex w-full items-center px-3.5 py-2 text-left text-sm transition hover:bg-secondary"
                      >
                        Archive
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">No chats match “{q}”.</li>
        ) : null}
      </ul>
    </div>
  );
}

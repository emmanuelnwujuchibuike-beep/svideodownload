"use client";

import { motion } from "framer-motion";
import { BadgeCheck, BellOff, Check, Loader2, MoreHorizontal, Pin, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { mutate, useQuery } from "@/features/data";
import { usePresence } from "@/features/friends/use-presence";
import { GroupAvatarStack } from "@/features/social/group-avatar-stack";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import type { FriendRequestItem } from "@/lib/social/friends";
import type { ConversationSummary } from "@/lib/social/messages";
import { cn } from "@/lib/utils";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "1d";
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

type InboxTab = "all" | "unread" | "groups" | "requests";

/**
 * Realtime inbox — seeded server-side (instant paint), then live-updated via the
 * shared INBOX_KEY cache. `variant="pane"` is the Glass Split desktop sidebar.
 *
 * 2026-07-12: rebuilt to the owner's inbox mockup — pill search bar, an
 * All / Unread / Groups / Requests filter row with live count badges (the
 * Requests tab is REAL: incoming friend requests with working Accept/Decline,
 * this app's actual equivalent of "message requests"), pinned conversations
 * as highlighted cards above a RECENT section, larger avatars with a brand
 * ring + presence dot, delivery-check preview prefix on your own last
 * message, and gradient unread-count badges.
 */
export function ConversationList({
  initial,
  variant = "page",
  initialRequests = [],
}: {
  initial: ConversationSummary[];
  variant?: "page" | "pane";
  initialRequests?: FriendRequestItem[];
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
  const [tab, setTab] = useState<InboxTab>("all");
  const [requests, setRequests] = useState<FriendRequestItem[]>(initialRequests);
  const [requestBusyId, setRequestBusyId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Portal-rendered + position computed on open (not a plain `absolute
  // right-2 top-9` sibling): a row near the bottom of the scrollable list
  // had this menu clipped by the list's own overflow — same class of bug,
  // same fix, as the message-actions menu in conversation-room.tsx.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const ROW_MENU_WIDTH = 160; // w-40
  const openRowMenu = (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    haptic("light");
    if (openMenuId === id) {
      setOpenMenuId(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const margin = 8;
    const menuHeight = 3 * 40 + 8; // Pin/Mute/Archive rows + py-1 padding
    const left = Math.min(Math.max(rect.right - ROW_MENU_WIDTH, margin), window.innerWidth - ROW_MENU_WIDTH - margin);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuHeight + margin ? rect.bottom + 4 : Math.max(margin, rect.top - menuHeight - 4);
    setMenuPos({ top, left });
    setOpenMenuId(id);
  };
  // Archiving used to be a one-way trap: the menu only ever set archived:true
  // (no Unarchive), and archived conversations were filtered out with no
  // other screen to find them again — they'd just silently vanish. This view
  // toggle + the Unarchive action below close that gap.
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = useMemo(() => conversations.filter((c) => c.archived).length, [conversations]);

  const notArchived = useMemo(() => conversations.filter((c) => !c.archived), [conversations]);
  const unreadCount = useMemo(() => notArchived.filter((c) => c.unread).length, [notArchived]);
  const groupCount = useMemo(() => notArchived.filter((c) => c.type === "group").length, [notArchived]);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    let base = conversations.filter((c) => (showArchived ? c.archived : !c.archived));
    if (!showArchived) {
      if (tab === "unread") base = base.filter((c) => c.unread);
      else if (tab === "groups") base = base.filter((c) => c.type === "group");
    }
    if (!query) return base;
    return base.filter((c) => {
      const name = c.type === "group" ? (c.title ?? "") : c.other!.displayName;
      const handle = c.type === "group" ? "" : c.other!.handle;
      return name.toLowerCase().includes(query) || handle.toLowerCase().includes(query);
    });
  }, [conversations, q, showArchived, tab]);

  const pinned = useMemo(() => visible.filter((c) => c.pinned), [visible]);
  const recent = useMemo(() => visible.filter((c) => !c.pinned), [visible]);

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

  const respondToRequest = async (req: FriendRequestItem, action: "accept" | "decline") => {
    if (requestBusyId) return;
    haptic("selection");
    setRequestBusyId(req.id);
    const prev = requests;
    setRequests((l) => l.filter((r) => r.id !== req.id));
    try {
      const res = await fetch(`/api/friends/${req.user.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) setRequests(prev);
    } catch {
      setRequests(prev);
    } finally {
      setRequestBusyId(null);
    }
  };

  const empty = conversations.length === 0 && requests.length === 0;
  if (empty) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground", pane && "m-3")}>
        No conversations yet. Open someone&apos;s profile and tap Message to start one.
      </div>
    );
  }

  const tabs: { id: InboxTab; label: string; badge: number }[] = [
    { id: "all", label: "All", badge: notArchived.length },
    { id: "unread", label: "Unread", badge: unreadCount },
    { id: "groups", label: "Groups", badge: groupCount },
    { id: "requests", label: "Requests", badge: requests.length },
  ];

  return (
    <div className={cn(pane && "flex min-h-0 flex-1 flex-col")}>
      {/* Search — the mockup's full-width glass pill */}
      <label className={cn("relative block", pane ? "mx-3 mb-2" : "mb-3")}>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search messages"
          aria-label="Search conversations"
          className="glass w-full rounded-full py-2.5 pl-11 pr-4 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-violet-500/30"
        />
      </label>

      {/* Filter tabs — All / Unread / Groups / Requests with live counts */}
      <div className={cn("mb-2 flex items-center gap-5 border-b border-border/40 px-1", pane && "mx-3")} role="tablist" aria-label="Filter conversations">
        {tabs.map((t) => {
          const active = tab === t.id && !showArchived;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                haptic("light");
                setShowArchived(false);
                setTab(t.id);
              }}
              className={cn(
                "relative flex items-center gap-1.5 pb-2 text-sm transition-colors",
                active ? "font-bold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.badge > 0 ? (
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                    active ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "bg-secondary text-muted-foreground",
                  )}
                >
                  {t.badge > 99 ? "99+" : t.badge}
                </span>
              ) : null}
              {active ? <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-violet-500" /> : null}
            </button>
          );
        })}
      </div>

      {showArchived ? (
        <button
          type="button"
          onClick={() => setShowArchived(false)}
          className={cn("mb-2 flex items-center gap-1.5 text-sm font-semibold text-primary", pane && "mx-3")}
        >
          ← Back to chats
        </button>
      ) : archivedCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowArchived(true)}
          className={cn("mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground", pane && "mx-3")}
        >
          Archived chats ({archivedCount})
        </button>
      ) : null}

      {tab === "requests" && !showArchived ? (
        <ul className={cn("space-y-2", pane && "min-h-0 flex-1 overflow-y-auto px-3 pb-3")}>
          {requests.map((req) => (
            <li key={req.id} className="glass flex items-center gap-3 rounded-2xl p-3">
              {req.user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={req.user.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-violet-500/25" />
              ) : (
                <span className="bg-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white">
                  {req.user.displayName.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold">
                  <span className="truncate">{req.user.displayName}</span>
                  {req.user.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                  <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{timeAgo(req.createdAt)}</span>
                </span>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{req.note || "Wants to be your friend"}</p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={requestBusyId === req.id}
                    onClick={() => respondToRequest(req, "accept")}
                    className="bg-brand flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
                  >
                    {requestBusyId === req.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={requestBusyId === req.id}
                    onClick={() => respondToRequest(req, "decline")}
                    className="flex items-center gap-1.5 rounded-full border border-border/70 px-4 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" /> Decline
                  </button>
                </div>
              </div>
            </li>
          ))}
          {requests.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">No pending requests.</li>
          ) : null}
        </ul>
      ) : (
        <ul className={cn("space-y-0.5", pane && "min-h-0 flex-1 overflow-y-auto px-2 pb-3")}>
          {pinned.map((c) => (
            <ConversationRow
              key={c.id}
              c={c}
              active={pane && pathname === `/messages/${c.id}`}
              onlineSet={online}
              pinnedCard
              openMenuId={openMenuId}
              menuPos={menuPos}
              onOpenMenu={openRowMenu}
              onCloseMenu={() => setOpenMenuId(null)}
              onUpdatePref={updatePref}
              menuWidth={ROW_MENU_WIDTH}
            />
          ))}
          {pinned.length > 0 && recent.length > 0 ? (
            <li className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">Recent</li>
          ) : null}
          {recent.map((c) => (
            <ConversationRow
              key={c.id}
              c={c}
              active={pane && pathname === `/messages/${c.id}`}
              onlineSet={online}
              openMenuId={openMenuId}
              menuPos={menuPos}
              onOpenMenu={openRowMenu}
              onCloseMenu={() => setOpenMenuId(null)}
              onUpdatePref={updatePref}
              menuWidth={ROW_MENU_WIDTH}
            />
          ))}
          {visible.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              {q.trim()
                ? `No chats match "${q}".`
                : showArchived
                  ? "No archived chats."
                  : tab === "unread"
                    ? "You're all caught up."
                    : tab === "groups"
                      ? "No group chats yet."
                      : "No conversations here yet."}
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function ConversationRow({
  c,
  active,
  onlineSet,
  pinnedCard = false,
  openMenuId,
  menuPos,
  onOpenMenu,
  onCloseMenu,
  onUpdatePref,
  menuWidth,
}: {
  c: ConversationSummary;
  active: boolean;
  onlineSet: Set<string>;
  pinnedCard?: boolean;
  openMenuId: string | null;
  menuPos: { top: number; left: number } | null;
  onOpenMenu: (id: string, e: React.MouseEvent<HTMLButtonElement>) => void;
  onCloseMenu: () => void;
  onUpdatePref: (id: string, patch: Partial<{ muted: boolean; archived: boolean; pinned: boolean }>) => void;
  menuWidth: number;
}) {
  const isGroup = c.type === "group";
  const isOnline = !isGroup && onlineSet.has(c.other!.id);
  const name = isGroup ? c.title ?? "Group chat" : c.other!.displayName;
  return (
    <li className="flex items-center">
      <Link
        href={`/messages/${c.id}`}
        onClick={() => haptic("light")}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-3 transition",
          pinnedCard && !active && "glass",
          active
            ? "bg-gradient-to-r from-blue-500/[0.10] to-violet-500/[0.10] ring-1 ring-inset ring-violet-500/25"
            : "hover:bg-secondary/40",
        )}
      >
        <span className="relative shrink-0">
          {isGroup ? (
            c.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.avatarUrl} alt="" className="h-[52px] w-[52px] rounded-full object-cover ring-2 ring-violet-500/30 ring-offset-2 ring-offset-background" />
            ) : (
              // The inbox list doesn't fetch per-member avatars (would add a
              // query per group just for this) — a group without a custom
              // photo falls back to the stack placeholder; the real
              // overlapping-avatars rendering lives in the thread header.
              <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-brand-tile ring-2 ring-violet-500/30 ring-offset-2 ring-offset-background">
                <GroupAvatarStack avatars={[]} />
              </span>
            )
          ) : c.other!.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.other!.avatarUrl}
              alt=""
              className={cn(
                "h-[52px] w-[52px] rounded-full object-cover ring-2 ring-offset-2 ring-offset-background",
                c.unread ? "ring-violet-500/60" : "ring-violet-500/25",
              )}
            />
          ) : (
            <span
              className={cn(
                "bg-brand flex h-[52px] w-[52px] items-center justify-center rounded-full text-lg font-bold text-white ring-2 ring-offset-2 ring-offset-background",
                c.unread ? "ring-violet-500/60" : "ring-violet-500/25",
              )}
            >
              {name.charAt(0).toUpperCase()}
            </span>
          )}
          {isOnline ? (
            <span aria-label="Online" className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center">
              <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:hidden" />
              <span className="relative h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-background" />
            </span>
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("truncate text-[15px]", c.unread ? "font-bold" : "font-semibold")}>{name}</span>
            {!isGroup && c.other!.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
            {c.muted ? <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
          </div>
          <p className={cn("mt-0.5 flex items-center gap-1 truncate text-sm", c.unread ? "text-foreground" : "text-muted-foreground")}>
            {c.fromMe ? <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="You sent" /> : null}
            <span className="truncate">{c.lastBody ?? "…"}</span>
          </p>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1.5 self-stretch py-0.5">
          <span className={cn("text-xs", c.unread ? "font-semibold text-violet-500 dark:text-violet-300" : "text-muted-foreground")}>{timeAgo(c.lastAt)}</span>
          {c.unreadCount > 0 && !c.muted ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-1.5 text-[10px] font-bold text-white">
              {c.unreadCount > 99 ? "99+" : c.unreadCount}
            </span>
          ) : c.pinned ? (
            <Pin className="h-3.5 w-3.5 text-muted-foreground/70" />
          ) : null}
        </span>
      </Link>

      {/* A flex sibling, not an absolutely-positioned overlay on top of the
          Link's own timestamp/unread-badge — and deliberately NOT hidden via
          opacity-0-until-hover, since touch devices have no hover state, which
          would make mute/pin/archive undiscoverable on mobile. */}
      <div className="relative shrink-0 pr-2">
        <motion.button
          type="button"
          onClick={(e) => onOpenMenu(c.id, e)}
          aria-label="Conversation options"
          whileTap={{ scale: 0.85 }}
          transition={springs.press}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/70 transition hover:bg-secondary hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </motion.button>
        {openMenuId === c.id && menuPos
          ? createPortal(
              <>
                <button type="button" aria-label="Close menu" onClick={onCloseMenu} className="fixed inset-0 z-40 cursor-default" />
                <div
                  style={{ top: menuPos.top, left: menuPos.left, width: menuWidth }}
                  className="glass-strong animate-scale-in fixed z-50 overflow-hidden rounded-2xl py-1"
                >
                  <button
                    type="button"
                    onClick={() => onUpdatePref(c.id, { pinned: !c.pinned })}
                    className="flex w-full items-center px-3.5 py-2 text-left text-sm transition hover:bg-secondary"
                  >
                    {c.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdatePref(c.id, { muted: !c.muted })}
                    className="flex w-full items-center px-3.5 py-2 text-left text-sm transition hover:bg-secondary"
                  >
                    {c.muted ? "Unmute" : "Mute"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdatePref(c.id, { archived: !c.archived })}
                    className="flex w-full items-center px-3.5 py-2 text-left text-sm transition hover:bg-secondary"
                  >
                    {c.archived ? "Unarchive" : "Archive"}
                  </button>
                </div>
              </>,
              document.body,
            )
          : null}
      </div>
    </li>
  );
}

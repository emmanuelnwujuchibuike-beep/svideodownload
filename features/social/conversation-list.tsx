"use client";

import { motion } from "framer-motion";
import { Archive as ArchiveIcon, BadgeCheck, BarChart3, BellOff, Check, CheckCheck, FileText, Image as ImageIcon, Loader2, MapPin, Mic, MoreHorizontal, Pin, Search, SlidersHorizontal, Trash2, User, Video as VideoIcon, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { mutate, useQuery } from "@/features/data";
import { usePresence } from "@/features/friends/use-presence";
import { isThreadWarm, warmThread } from "@/features/social/thread-cache";
import { GroupAvatarStack } from "@/features/social/group-avatar-stack";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";
import { useTypingIndicator } from "@/features/social/use-typing";
import { haptic } from "@/lib/motion/haptics";
import { isSlowConnection } from "@/lib/pwa/use-network-status";
import { springs } from "@/lib/motion/springs";
import type { FriendRequestItem } from "@/lib/social/friends";
import type { ConversationSummary } from "@/lib/social/messages";
import { cn } from "@/lib/utils";

/** How many threads the inbox pre-loads, in display order. The room's own
 *  thread cache holds 10, so warming past this would only evict what it just
 *  fetched. */
const WARM_THREAD_LIMIT = 10;

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

async function setPrefs(conversationId: string, patch: Partial<{ muted: boolean; archived: boolean; pinned: boolean; hidden: boolean }>): Promise<boolean> {
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
 * The inbox preview line (owner, 2026-07-16): "include video when a video is
 * sent, and image when image is sent, and audio when audio is sent last, and
 * location when location is sent last, or if is a text chat the first 4 or 3
 * words of the last chat should show."
 *
 * Icons, never emoji — the standing app rule. An attachment-only message used
 * to leave this line as a bare tick (visible in the owner's screenshot),
 * because the preview trigger fires on the message insert and attachments land
 * in a separate one — see listConversations, which resolves the media kind.
 */
const PREVIEW_ICON: Record<string, typeof MapPin | null> = {
  location: MapPin,
  contact: User,
  poll: BarChart3,
  image: ImageIcon,
  video: VideoIcon,
  audio: Mic,
  file: FileText,
  none: null,
};

const PREVIEW_LABEL: Record<string, string> = {
  location: "Location",
  contact: "Contact",
  poll: "Poll",
  image: "Photo",
  video: "Video",
  audio: "Audio",
  file: "Document",
};

/** Owner: "the first 4 or 3 words of the last chat should show." Four. The row
 *  already truncates with an ellipsis, so this is about not handing a whole
 *  paragraph to the list, not a hard character budget. */
const PREVIEW_WORDS = 4;

function previewText(kind: string | null, body: string | null): string {
  // A media/metadata message says what it IS. A CAPTIONED one keeps its caption
  // — the caption is more informative than the word "Photo" — which is why
  // `previewKindFor` server-side only reports a media kind when the body was
  // empty.
  if (kind && PREVIEW_LABEL[kind]) return PREVIEW_LABEL[kind]!;
  const text = (body ?? "").trim();
  if (!text) return "…";
  const words = text.split(/\s+/);
  return words.length <= PREVIEW_WORDS ? text : `${words.slice(0, PREVIEW_WORDS).join(" ")}…`;
}

/**
 * Delivery ticks on the inbox row — so you can read your last message's state
 * without opening the chat (owner, 2026-07-16: "delivered 2 blue tick, seen 2
 * green tick without anyone needing to enter the chat to see, they just see it
 * outside just like whatsapp and go to the next").
 *
 * Colours are the owner's, NOT WhatsApp's (WhatsApp is grey/grey/blue): one
 * tick sent, two BLUE delivered, two GREEN seen. The thread's own receipt line
 * keeps its wording ("Sent/Delivered/Seen") — this is the same three states
 * rendered compactly.
 *
 * `status` is null when there's nothing honest to show — a group (no
 * per-message read state exists), a secret chat, or a last message that wasn't
 * yours. It falls back to a single neutral tick rather than inventing a state.
 * "Seen" is suppressed server-side when the recipient has read receipts off;
 * see ConversationSummary.lastStatus.
 */
function LastStatusTicks({ status }: { status: "sent" | "delivered" | "seen" | null }) {
  if (status === "seen") {
    return <CheckCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Seen" />;
  }
  if (status === "delivered") {
    return <CheckCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-label="Delivered" />;
  }
  return <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Sent" />;
}

type InboxTab = "all" | "unread" | "groups" | "requests" | "channels";

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
  viewerId,
}: {
  initial: ConversationSummary[];
  variant?: "page" | "pane";
  initialRequests?: FriendRequestItem[];
  /** Owner ask: show "Typing…" on a row without opening the thread. Only
   *  used to skip our own presence key and to cap how many rows subscribe
   *  (below) — the list never broadcasts its own typing state. */
  viewerId: string;
}) {
  // Live updates come from InboxRealtimeTracker (mounted once in the app
  // shell) revalidating this same shared cache — no second subscription here.
  const { data } = useQuery<Inbox>(INBOX_KEY, loadInbox, {
    initialData: { conversations: initial, unread: initial.filter((c) => c.unread).length },
  });
  const conversations = data?.conversations ?? initial;
  const router = useRouter();

  // Owner ask: "all chats should download automatically... to avoid load
  // when entering each chat." `router.prefetch()` is Next's own supported
  // route-prefetch — it warms the route's JS chunk + RSC payload ahead of the
  // tap. The MESSAGES themselves are warmed separately, just below.
  //
  // History worth keeping: an earlier `prefetchAllThreads` did the message half
  // and was DELETED for two reasons — nothing read its cache back out, and it
  // silently marked every other member's messages read/delivered on every inbox
  // load, a real privacy leak against the read-receipts toggle. Both are fixed
  // now, deliberately: the warm-up below writes into the same module cache
  // `ConversationRoom` actually reads on mount, and it goes through `?peek=1`,
  // which reads without touching receipts.
  //
  // Sorted (not insertion-order) so a live reorder of the SAME conversation
  // set — new message bumping a thread to the top — doesn't recompute this
  // key and re-fire the warm-up; only an actual join/leave does. Capped so
  // a very large inbox can't fire an unbounded prefetch burst.
  const idsKey = [...conversations.map((c) => c.id)].sort().join(",");
  useEffect(() => {
    if (!idsKey) return;
    for (const id of idsKey.split(",").slice(0, 20)) router.prefetch(`/messages/${id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey IS the dependency; conversations/router change identity too often (live badge/order updates)
  }, [idsKey]);

  // Message warm-up (owner, 2026-07-16: "chats should load one after the other
  // from top to bottom immediately the message page is opened to avoid loading
  // of chats").
  //
  // `router.prefetch` above only warms the ROUTE (chunk + RSC payload); the
  // thread's message list was still fetched on open. This pre-loads the
  // messages themselves into the SAME module cache `ConversationRoom` reads on
  // mount, so opening a warmed chat paints in the first frame.
  //
  // Three constraints, each load-bearing:
  //  1. `?peek=1` — reads WITHOUT marking anything read. An earlier warm-up was
  //     DELETED for exactly this: going through the normal path marked every
  //     conversation read just from opening the inbox, showing senders a false
  //     "Seen". See getConversation's `peek` option.
  //  2. Strictly SEQUENTIAL, in display order — "one after the other from top to
  //     bottom" is also the right engineering: 20 parallel thread fetches would
  //     saturate a phone's connection and make the FIRST chat (the one most
  //     likely to be tapped) slower, not faster.
  //  3. Skipped on data-saver/2G, and cancelled on unmount — this spends
  //     bandwidth on chats the user may never open, so it must never cost a
  //     constrained viewer anything.
  // The room still resyncs on mount, so a warmed thread is never stale-but-
  // trusted; warming only removes the visible load.
  const orderKey = conversations.map((c) => c.id).join(",");
  useEffect(() => {
    if (!orderKey || isSlowConnection()) return;
    let cancelled = false;
    const ids = orderKey.split(",").slice(0, WARM_THREAD_LIMIT);
    (async () => {
      for (const id of ids) {
        if (cancelled) return;
        if (isThreadWarm(id)) continue;
        await warmThread(id);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- orderKey IS the dependency
  }, [orderKey]);

  const pathname = usePathname();
  const online = usePresence();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<InboxTab>("all");
  const [requests, setRequests] = useState<FriendRequestItem[]>(initialRequests);
  const [requestBusyId, setRequestBusyId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Owner ask: only one row's swipe-reveal strip open at a time — opening a
  // new one closes whichever was already open, instead of each row tracking
  // its own independent swipeOpen state.
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
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
    // Channels aren't a real feature yet (owner-scoped: coming soon) — no
    // conversation is ever a channel, so this tab always shows the empty
    // state below rather than silently falling through to "All".
    if (tab === "channels" && !showArchived) return [];
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
  // Owner mockup: pinned conversations get their OWN compact avatar-strip
  // shortcut row up top, but still appear with full detail (preview, unread,
  // typing) in the list below — unlike the previous "hide pinned from the
  // rest of the list" behavior, nothing here disappears once pinned.
  const recent = visible;
  const [showAllPinned, setShowAllPinned] = useState(false);
  const PINNED_STRIP_CAP = 6;
  const pinnedStrip = showAllPinned ? pinned : pinned.slice(0, PINNED_STRIP_CAP);

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

  // Swipe action "Delete" — a per-user hide (see the `hidden_at` migration
  // comment), not a destructive delete of shared data. Removed from the local
  // cache immediately (unlike mute/archive, a hidden row shouldn't linger in
  // ANY current view) and restored on failure.
  const deleteConversation = async (id: string) => {
    if (!window.confirm("Delete this conversation? It'll come back if there's new activity.")) return;
    haptic("selection");
    const snapshot = conversations;
    mutate<Inbox>(INBOX_KEY, (prev) => (prev ? { ...prev, conversations: prev.conversations.filter((c) => c.id !== id) } : EMPTY_INBOX));
    const ok = await setPrefs(id, { hidden: true });
    if (!ok) mutate<Inbox>(INBOX_KEY, (prev) => (prev ? { ...prev, conversations: snapshot } : EMPTY_INBOX));
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
    // Owner-scoped: a real tab in the filter row (matching the mockup) backed
    // by a "coming soon" empty state — not a new broadcast-room feature yet.
    { id: "channels", label: "Channels", badge: 0 },
  ];

  return (
    <div className={cn("frenz-inbox", pane && "flex min-h-0 flex-1 flex-col")}>
      {/* Search — the mockup's full-width glass pill, with a trailing filter
          icon that jumps to Archived (the one filter view not already a tab). */}
      <label className={cn("relative block", pane ? "mx-3 mb-2" : "mb-3")}>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search messages, users, groups…"
          aria-label="Search conversations"
          className="glass w-full rounded-full py-2.5 pl-11 pr-11 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-violet-500/30"
        />
        <button
          type="button"
          onClick={() => {
            haptic("light");
            setShowArchived((v) => !v);
          }}
          aria-label={showArchived ? "Show all chats" : "Show archived chats"}
          aria-pressed={showArchived}
          className={cn(
            "absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full transition",
            showArchived ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
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
        <ul className={cn("space-y-2", pane && "min-h-0 flex-1 overflow-y-auto overscroll-y-none px-3 pb-3")}>
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
        <ul
          className={cn(
            // Owner ask (2026-07-16): rows should sit "tightly close to each
            // other, not separated — the line already is enough to separate
            // them, just like WhatsApp." So NO gap between rows (space-y-0):
            // adjacent rows butt together and the single hairline divider on
            // each row (border-b below) does all the separating, exactly like
            // a WhatsApp/iMessage chat list. (Was space-y-2 / 8px, which read
            // as detached cards rather than one continuous list.)
            "space-y-0",
            pane && "min-h-0 flex-1 overflow-y-auto overscroll-y-none px-2 pb-3",
          )}
        >
          {pinned.length > 0 ? (
            <li className={cn(pane && "px-1")}>
              <div className="mb-2 flex items-center justify-between px-2 pt-1">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                  <Pin className="h-3 w-3" /> Pinned
                </span>
                {pinned.length > PINNED_STRIP_CAP ? (
                  <button
                    type="button"
                    onClick={() => setShowAllPinned((v) => !v)}
                    className="text-xs font-semibold text-primary"
                  >
                    {showAllPinned ? "Show less" : "View all"}
                  </button>
                ) : null}
              </div>
              <div className="-mx-1 mb-1 flex gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {pinnedStrip.map((c) => {
                  const isGroup = c.type === "group";
                  const name = isGroup ? c.title ?? "Group chat" : c.other!.displayName;
                  return (
                    <Link
                      key={c.id}
                      href={`/messages/${c.id}`}
                      onClick={() => haptic("light")}
                      className="flex w-16 shrink-0 flex-col items-center gap-1"
                    >
                      <span className="relative">
                        {/* Vivid gradient ring (owner mockup) — a padded gradient
                            wrapper, not a thin `ring-*` outline, so it actually
                            reads as a distinct colored border like the mockup's
                            story-style rings, matching the same `bg-brand` ring
                            trick stories-row.tsx already uses. */}
                        <span className="bg-brand block rounded-full p-[2.5px]">
                          {c.avatarUrl || (!isGroup && c.other!.avatarUrl) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={(isGroup ? c.avatarUrl : c.other!.avatarUrl) ?? undefined}
                              alt=""
                              className="h-14 w-14 rounded-full object-cover ring-2 ring-card"
                            />
                          ) : (
                            <span className="bg-brand flex h-14 w-14 items-center justify-center rounded-full text-base font-bold text-white ring-2 ring-card">
                              {name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="w-full truncate text-center text-xs font-medium text-muted-foreground">{name}</span>
                    </Link>
                  );
                })}
              </div>
            </li>
          ) : null}
          {pinned.length > 0 && recent.length > 0 ? (
            <li className="px-3 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">Recent</li>
          ) : null}
          {recent.map((c, i) => (
            <ConversationRow
              key={c.id}
              c={c}
              active={pane && pathname === `/messages/${c.id}`}
              onlineSet={online}
              openMenuId={openMenuId}
              menuPos={menuPos}
              onOpenMenu={openRowMenu}
              viewerId={viewerId}
              // Capped like the route-prefetch effect above — a very long
              // inbox shouldn't open dozens of realtime channels at once just
              // for rows the viewer isn't even looking at. Safe for the SAME
              // conversation to also be observed elsewhere at once (the open
              // thread, the desktop pane's list mounted alongside the mobile
              // list) — `useTypingIndicator`'s channel is a shared, ref-
              // counted singleton per conversationId now (see use-typing.ts),
              // not one realtime channel per observer.
              subscribeTyping={i < 25}
              onCloseMenu={() => setOpenMenuId(null)}
              onUpdatePref={updatePref}
              onDelete={deleteConversation}
              menuWidth={ROW_MENU_WIDTH}
              swipeOpen={swipeOpenId === c.id}
              onSwipeOpen={(open) => setSwipeOpenId(open ? c.id : null)}
            />
          ))}
          {visible.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              {q.trim()
                ? `No chats match "${q}".`
                : showArchived
                  ? "No archived chats."
                  : tab === "channels"
                    ? "Channels are coming soon."
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

const SWIPE_STRIP_WIDTH = 152;

function ConversationRow({
  c,
  active,
  onlineSet,
  openMenuId,
  menuPos,
  onOpenMenu,
  onCloseMenu,
  onUpdatePref,
  onDelete,
  menuWidth,
  viewerId,
  subscribeTyping,
  swipeOpen,
  onSwipeOpen,
}: {
  c: ConversationSummary;
  active: boolean;
  onlineSet: Set<string>;
  openMenuId: string | null;
  menuPos: { top: number; left: number } | null;
  onOpenMenu: (id: string, e: React.MouseEvent<HTMLButtonElement>) => void;
  onCloseMenu: () => void;
  onUpdatePref: (id: string, patch: Partial<{ muted: boolean; archived: boolean; pinned: boolean }>) => void;
  onDelete: (id: string) => void;
  menuWidth: number;
  viewerId: string;
  subscribeTyping: boolean;
  swipeOpen: boolean;
  onSwipeOpen: (open: boolean) => void;
}) {
  const isGroup = c.type === "group";
  const name = isGroup ? c.title ?? "Group chat" : c.other!.displayName;
  // Owner ask: "see when a user is typing from outside [the open thread]" —
  // read-only (broadcastEnabled=false: this row never has a composer, so it
  // must never emit its own typing:true) use of the SAME hook the open thread
  // already relies on. `subscribeTyping` (capped upstream) avoids opening a
  // realtime channel per row for a very long inbox.
  const { typingNames } = useTypingIndicator(subscribeTyping ? c.id : "", viewerId, "", false);
  const isTyping = subscribeTyping && typingNames.length > 0;
  // Swipe-to-reveal More/Archive/Delete (owner mockup) — a drag gesture
  // alongside (not replacing) the existing "…" button, since a mockup's
  // swipe affordance isn't always discoverable and the tap target already
  // works. `swipeOpen` is owned by the parent list (owner ask: opening one
  // row's strip must close any other already-open one) — was per-row local
  // state, so two rows could be swiped open at once.
  const setSwipeOpen = onSwipeOpen;
  return (
    // Owner ask (2026-07-16): rows sit flush like WhatsApp, separated only by
    // a single hairline BETWEEN them — no per-row rounded card, no gap. One
    // `border-b` per row (last row omits it) gives exactly one divider line
    // between adjacent rows instead of the previous stacked top+bottom borders
    // that a between-row gap forced.
    <li className="relative flex items-center overflow-hidden border-b border-border/40 last:border-b-0">
      {/* Revealed strip — sits BEHIND the row, only visible once dragged/opened. */}
      <div className="absolute inset-y-0 right-0 flex items-center gap-1.5 pr-1" style={{ width: SWIPE_STRIP_WIDTH }}>
        <button
          type="button"
          onClick={(e) => {
            setSwipeOpen(false);
            onOpenMenu(c.id, e);
          }}
          className="flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl bg-secondary text-[11px] font-semibold text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" /> More
        </button>
        <button
          type="button"
          onClick={() => {
            setSwipeOpen(false);
            onUpdatePref(c.id, { archived: !c.archived });
          }}
          className="flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl bg-blue-600 text-[11px] font-semibold text-white"
        >
          <ArchiveIcon className="h-4 w-4" /> {c.archived ? "Unarchive" : "Archive"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSwipeOpen(false);
            onDelete(c.id);
          }}
          className="flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl bg-red-600 text-[11px] font-semibold text-white"
        >
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      </div>
      <motion.div
        drag="x"
        // Third pass at "it opens on a light touch" (owner 2026-07-15, again
        // 2026-07-16 — and it matters more now that the per-row "…" is gone and
        // this gesture is the ONLY way in). The previous two passes only ever
        // tuned the onDragEnd THRESHOLDS, which was treating the symptom: the
        // drag itself still ENGAGED on any horizontal movement at all, so the
        // row visibly slid under a fingertip that was only trying to scroll the
        // list or tap the chat. `dragDirectionLock` is the actual fix — framer
        // commits the gesture to ONE axis after the first few pixels, so a
        // vertical scroll (or a near-vertical thumb drag) never moves this row
        // sideways at all, and a tap moves nothing.
        dragDirectionLock
        dragConstraints={{ left: -SWIPE_STRIP_WIDTH, right: 0 }}
        dragElastic={0.06}
        dragMomentum={false}
        animate={{ x: swipeOpen ? -SWIPE_STRIP_WIDTH : 0 }}
        transition={springs.sheet}
        onDragEnd={(_, info) => {
          // With engagement fixed above, these only decide "did a real slide go
          // far enough to latch open" — so they're raised again to demand a
          // deliberate gesture: ~70% of the strip (was 55%), or a genuinely hard
          // flick that ALSO covered ~45% (was 25%) at a higher velocity bar.
          // Anything less springs back closed.
          const draggedFar = info.offset.x < -SWIPE_STRIP_WIDTH * 0.7;
          const firmFlick = info.offset.x < -SWIPE_STRIP_WIDTH * 0.45 && info.velocity.x < -1200;
          const shouldOpen = draggedFar || firmFlick;
          setSwipeOpen(shouldOpen);
          if (shouldOpen) haptic("light");
        }}
        className="relative z-10 flex w-full items-center bg-background"
      >
      {/* Owner ask: the avatar should sit at the very edge on mobile — was
          double-inset (the page container's own px-3 PLUS this row's own
          left padding stacked on top), pushing it noticeably further in than
          the search bar/tabs above it align to. pl-0 makes the avatar align
          with everything else's edge instead of sitting an extra 12px in. */}
      <Link
        href={`/messages/${c.id}`}
        onClick={() => haptic("light")}
        className={cn(
          // active:scale — a plain CSS press (not framer's whileTap, this is
          // a plain <Link>, not a motion component) so every row gives real
          // tactile feedback on tap, matching the tap-feedback standard every
          // other interactive surface in this app already has (owner ask,
          // 2026-07-14: "premium, lively" — a row with zero press feedback on
          // the PRIMARY mobile surface of this feature was a real gap).
          // -ml-2 (2026-07-15, pushed further per owner follow-up: "the
          // profile header and name" still wasn't far enough left) pulls 8px
          // past the page's own 12px gutter (px-3), landing the avatar+name
          // block ~4px from the true screen edge — pl-0 alone only matched
          // the search bar/tabs' OWN inset, not the actual edge. Deliberately
          // now MORE left than the header title block above (pl-1 there) —
          // the two are meant to read as different insets, not one shared
          // column.
          // rounded-none (2026-07-16): rows are flush WhatsApp-style now, so
          // the tap/active highlight fills the full-width row rectangle instead
          // of a floating rounded card.
          "frenz-conversation-row -ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-none py-3.5 pl-0 pr-3 transition active:scale-[0.99]",
          active
            ? "bg-gradient-to-r from-blue-500/[0.10] to-violet-500/[0.10] ring-1 ring-inset ring-violet-500/25"
            : "hover:bg-secondary/40",
        )}
      >
        {/* Left-edge unread dot (owner mockup) — a small bullet ahead of the
            avatar on every row, distinct from the unread-count badge on the
            right; purple while unread, a quiet gray dot otherwise so read
            rows still align instead of the row visibly shifting. */}
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.unread ? "bg-[hsl(var(--brand-purple))]" : "bg-transparent")}
        />
        <span className="relative shrink-0">
          {/* Vivid gradient ring (owner mockup) — a padded `bg-brand` wrapper,
              not a thin `ring-*` outline, so every avatar in the list reads as
              distinctly bordered like the mockup, matching the same trick
              used on the pinned strip above and stories-row.tsx elsewhere. */}
          <span className="bg-brand block rounded-full p-[2.5px]">
            {isGroup ? (
              c.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatarUrl} alt="" className="h-[52px] w-[52px] rounded-full object-cover ring-2 ring-card" />
              ) : (
                // The inbox list doesn't fetch per-member avatars (would add a
                // query per group just for this) — a group without a custom
                // photo falls back to the stack placeholder; the real
                // overlapping-avatars rendering lives in the thread header.
                <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-brand-tile ring-2 ring-card">
                  <GroupAvatarStack avatars={[]} />
                </span>
              )
            ) : c.other!.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.other!.avatarUrl} alt="" className="h-[52px] w-[52px] rounded-full object-cover ring-2 ring-card" />
            ) : (
              <span className="bg-brand flex h-[52px] w-[52px] items-center justify-center rounded-full text-lg font-bold text-white ring-2 ring-card">
                {name.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("truncate text-[15px]", c.unread ? "font-bold" : "font-semibold")}>{name}</span>
            {!isGroup && c.other!.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
            {c.muted ? <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
          </div>
          {isTyping ? (
            <p className="mt-0.5 flex items-center gap-1 truncate text-sm font-medium text-violet-500 dark:text-violet-300">
              <span className="truncate">Typing…</span>
              <span className="flex items-center gap-0.5" aria-hidden>
                <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0.2s]" />
              </span>
            </p>
          ) : (
            <p className={cn("mt-0.5 flex items-center gap-1 truncate text-sm", c.unread ? "text-foreground" : "text-muted-foreground")}>
              {c.fromMe ? <LastStatusTicks status={c.lastStatus} /> : null}
              {/* A real icon for what kind of message this was — never an
                  emoji standing in for one (standing app rule). */}
              {(() => {
                const Icon = PREVIEW_ICON[c.lastMessageKind ?? "none"];
                return Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null;
              })()}
              <span className="truncate">{previewText(c.lastMessageKind, c.lastBody)}</span>
            </p>
          )}
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

      {/* Owner (2026-07-16): the per-row "…" button is GONE — "the dotted menu
          in message should be removed and users should only use the slide left
          for menu." Swipe-left is now the ONLY per-chat menu, which is what
          makes the list read cleanly (every row carried a permanent "…" before;
          see the owner's own screenshot of the inbox).
          The dropdown itself deliberately STAYS: the swipe strip's own "More"
          button (above) opens it and anchors it off its own rect, so Pin / Mute
          / Archive are all still reachable — just behind the gesture rather
          than a permanent glyph on every row. Removing the dropdown too would
          have made those three actions unreachable entirely. */}
      <div className="relative shrink-0">
        {openMenuId === c.id && menuPos
          ? createPortal(
              <>
                {/* onPointerDown, not onClick — see the same fix + rationale
                    on the message-bubble menu's backdrop in conversation-room.tsx. */}
                <button type="button" aria-label="Close menu" onPointerDown={onCloseMenu} className="fixed inset-0 z-40 cursor-default" />
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
      </motion.div>
    </li>
  );
}

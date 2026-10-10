"use client";

import {
  BadgeCheck,
  Compass,
  Hand,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Sparkles,
  Send,
  Star,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { FriendCelebration } from "@/features/friends/friend-celebration";
import { FollowRequestsSection } from "@/features/friends/follow-requests";
import { RequestCard } from "@/features/friends/request-card";
import { filterRequests, REQUEST_FILTERS, type RequestFilter } from "@/features/friends/request-logic";
import { AmbientWash, GLASS, GlassGroup, GlassIconLink, iconButton, PersonAvatar, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { usePresence } from "@/features/friends/use-presence";
import { timeAgo } from "@/features/notifications/meta";
import type { FriendItem, FriendProfile, FriendRequestItem, FriendsOverview } from "@/lib/social/friends";
import { cn } from "@/lib/utils";

/**
 * /friends — Smart Friends Hub v2 (Friends Hub spec): Friend Orbit signature
 * header, instant search, smart tabs (All / Favorites / Recently Active / New),
 * Smart Catch-Up nudges, unread badges + last-chat recency on every row.
 * Everything is driven by real data (friendships, favorites, DM inbox) —
 * no invented scores. SSR-seeded; actions optimistic, revert on error.
 */

const DAY = 24 * 60 * 60 * 1000;
type Tab = "all" | "online" | "favorites" | "active" | "new";



const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "online", label: "Online" },
  { id: "favorites", label: "Favorites" },
  { id: "active", label: "Recently Active" },
  { id: "new", label: "New" },
];

export function FriendsHub({ initial }: { initial: FriendsOverview }) {
  const router = useRouter();
  const [incoming, setIncoming] = useState<FriendRequestItem[]>(initial.incoming);
  const [outgoing, setOutgoing] = useState<FriendRequestItem[]>(initial.outgoing);
  const [friends, setFriends] = useState<FriendItem[]>(initial.friends);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState<FriendProfile | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  // Live green dots — everyone currently in the shared presence channel.
  const online = usePresence();

  // Feature 19 · Part 2 — ignore (silent) and Accept As (a label on accept)
  const respond = async (req: FriendRequestItem, action: "accept" | "decline" | "ignore", as?: string) => {
    if (busyId) return;
    setBusyId(req.id);
    const prevIn = incoming;
    const prevFriends = friends;
    setIncoming((l) => l.filter((r) => r.id !== req.id));
    if (action === "accept") {
      setFriends((l) => [
        { since: new Date().toISOString(), favorite: false, lastChatAt: null, unread: 0, user: req.user },
        ...l,
      ]);
    }
    try {
      const res = await fetch(`/api/friends/${req.user.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(as ? { action, as } : { action }),
      });
      if (!res.ok) {
        setIncoming(prevIn);
        setFriends(prevFriends);
      } else if (action === "accept") {
        setCelebrating(req.user);
      }
    } catch {
      setIncoming(prevIn);
      setFriends(prevFriends);
    } finally {
      setBusyId(null);
    }
  };

  const [requestFilter, setRequestFilter] = useState<RequestFilter>("newest");
  const visibleRequests = useMemo(() => filterRequests(incoming, requestFilter), [incoming, requestFilter]);

  /** Follow instead: follow them, and quietly set the request aside (ignore) — they keep a follower, not a friend. */
  const followInstead = async (req: FriendRequestItem) => {
    if (busyId) return;
    const res = await fetch(`/api/follow/${req.user.id}`, { method: "POST" }).catch(() => null);
    if (res?.ok) await respond(req, "ignore");
  };

  /** Block from the request itself — the block route also closes the request and any friendship (app/api/block). */
  const blockRequester = async (req: FriendRequestItem) => {
    if (busyId) return;
    setBusyId(req.id);
    const prev = incoming;
    setIncoming((l) => l.filter((r) => r.id !== req.id));
    try {
      const res = await fetch(`/api/block/${req.user.id}`, { method: "POST" });
      if (!res.ok) setIncoming(prev);
    } catch {
      setIncoming(prev);
    } finally {
      setBusyId(null);
    }
  };

  // Star/unstar — optimistic re-sort (favorites float to the top), revert on error.
  const toggleFavorite = async (id: string, on: boolean) => {
    const resort = (l: FriendItem[]) => [...l].sort((a, b) => Number(b.favorite) - Number(a.favorite));
    setFriends((l) => resort(l.map((f) => (f.user.id === id ? { ...f, favorite: on } : f))));
    try {
      const res = await fetch(`/api/friends/${id}/favorite`, { method: on ? "POST" : "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setFriends((l) => resort(l.map((f) => (f.user.id === id ? { ...f, favorite: !on } : f))));
    }
  };

  const cancel = async (req: FriendRequestItem) => {
    if (busyId) return;
    setBusyId(req.id);
    const prev = outgoing;
    setOutgoing((l) => l.filter((r) => r.id !== req.id));
    try {
      const res = await fetch(`/api/friends/${req.user.id}`, { method: "DELETE" });
      if (!res.ok) setOutgoing(prev);
    } catch {
      setOutgoing(prev);
    } finally {
      setBusyId(null);
    }
  };

  // Instant search + smart tab filters — all client-side over the loaded set.
  const now = Date.now();
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = friends;
    if (q) {
      list = list.filter(
        (f) => f.user.displayName.toLowerCase().includes(q) || f.user.handle.toLowerCase().includes(q),
      );
    }
    switch (tab) {
      case "online":
        return list.filter((f) => online.has(f.user.id));
      case "favorites":
        return list.filter((f) => f.favorite);
      case "active":
        return list
          .filter((f) => f.lastChatAt && now - new Date(f.lastChatAt).getTime() < 7 * DAY)
          .sort((a, b) => (b.lastChatAt ?? "").localeCompare(a.lastChatAt ?? ""));
      case "new":
        return list
          .filter((f) => now - new Date(f.since).getTime() < 30 * DAY)
          .sort((a, b) => b.since.localeCompare(a.since));
      default:
        return list;
    }
  }, [friends, query, tab, now, online]);

  // Smart Catch-Up: quiet friendships (3+ days old, no chat in 14+ days). Max 3.
  const catchUp = useMemo(
    () =>
      friends
        .filter(
          (f) =>
            now - new Date(f.since).getTime() > 3 * DAY &&
            (!f.lastChatAt || now - new Date(f.lastChatAt).getTime() > 14 * DAY),
        )
        .slice(0, 3),
    [friends, now],
  );

  const favorites = friends.filter((f) => f.favorite);
  const empty = incoming.length === 0 && outgoing.length === 0 && friends.length === 0;
  const counts: Record<Tab, number> = {
    all: friends.length,
    online: friends.filter((f) => online.has(f.user.id)).length,
    favorites: favorites.length,
    active: friends.filter((f) => f.lastChatAt && now - new Date(f.lastChatAt).getTime() < 7 * DAY).length,
    new: friends.filter((f) => now - new Date(f.since).getTime() < 30 * DAY).length,
  };
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  /*
    2026-10-10 redesign (owner: "glassy, professional, lightweight social
    platform") — features/friends/ui.tsx holds the language. The data, the
    actions and their optimistic rollbacks are unchanged; only the surface is.
  */
  return (
    <div className="relative isolate mx-auto w-full max-w-2xl">
      <AmbientWash />

      <header className="mb-5 flex items-start justify-between gap-3 pt-1">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.75rem,7.5vw,2.1rem)] font-extrabold leading-none tracking-[-0.035em]">Friends</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {plural(friends.length, "friend", "friends")}
            {counts.online ? ` · ${counts.online} online` : ""}
            {incoming.length ? ` · ${plural(incoming.length, "request", "requests")}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/friends/discover" prefetch className={primaryPill} aria-label="Add friends">
            <UserPlus className="h-4 w-4" aria-hidden />
            <span className="max-[359px]:sr-only">Add</span>
          </Link>
          <GlassIconLink href="/friends/circles" label="Circles">
            <Users className="h-[18px] w-[18px]" aria-hidden />
          </GlassIconLink>
          <GlassIconLink href="/friends/trust" label="Trust Center">
            <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
          </GlassIconLink>
        </div>
      </header>

      {favorites.length > 0 ? (
        <section className="mb-5" aria-labelledby="friends-favourites">
          <SectionHeader id="friends-favourites" title="Favourites" count={favorites.length} />
          <div className={cn("flex gap-3 overflow-x-auto rounded-[22px] px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", GLASS)}>
            {favorites.map((f) => (
              <Link
                key={f.user.id}
                href={`/messages/new/${f.user.id}`}
                prefetch={false}
                aria-label={`Message ${f.user.displayName}${f.unread ? `, ${f.unread} unread` : ""}`}
                className="flex w-[60px] shrink-0 flex-col items-center gap-1.5 text-center"
              >
                <span className="relative">
                  <PersonAvatar user={f.user} size={52} online={online.has(f.user.id)} />
                  {f.unread > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-white dark:ring-slate-900">
                      {f.unread > 9 ? "9+" : f.unread}
                    </span>
                  ) : null}
                </span>
                <span className="w-full truncate text-[11.5px] font-medium">{f.user.displayName.split(" ")[0]}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Feature 19 · Part 3 — only when the account approves followers and someone asked */}
      <FollowRequestsSection />

      {incoming.length > 0 ? (
        <section className="mb-5" aria-labelledby="friends-requests">
          <SectionHeader id="friends-requests" title="Friend requests" count={incoming.length} />
          {incoming.length > 1 ? (
            <div className="mb-2 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Sort and filter requests">
              {REQUEST_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={requestFilter === f.id}
                  onClick={() => setRequestFilter(f.id)}
                  className={cn(
                    "min-h-[2.25rem] shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold transition",
                    requestFilter === f.id ? "bg-foreground text-background" : cn(GLASS, "shadow-none text-muted-foreground hover:text-foreground"),
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          ) : null}
          <GlassGroup label="Friend requests">
            {visibleRequests.map((req) => (
              <RequestCard
                key={req.id}
                req={req}
                busy={busyId === req.id}
                onRespond={(action, as) => void respond(req, action, as)}
                onFollowInstead={() => void followInstead(req)}
                onBlock={() => void blockRequester(req)}
              />
            ))}
            {visibleRequests.length === 0 ? <li className="px-4 py-4 text-sm text-muted-foreground">No requests match this filter.</li> : null}
          </GlassGroup>
        </section>
      ) : null}

      {catchUp.length > 0 ? (
        <section className="mb-5" aria-labelledby="friends-catchup">
          <SectionHeader
            id="friends-catchup"
            title="Catch up"
            action={<Sparkles className="h-4 w-4 text-primary" aria-hidden />}
          />
          <GlassGroup label="Friends to catch up with">
            {catchUp.map((f) => (
              <li key={f.user.id} className="flex items-center gap-3 px-3.5 py-3">
                <PersonAvatar user={f.user} />
                <p className="min-w-0 flex-1 text-[14px] leading-snug text-muted-foreground">
                  {f.lastChatAt ? (
                    <>
                      <strong className="font-semibold text-foreground">{f.user.displayName}</strong> · last chat {timeAgo(f.lastChatAt)} ago
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold text-foreground">{f.user.displayName}</strong> · you haven&apos;t chatted yet
                    </>
                  )}
                </p>
                <Link href={`/messages/new/${f.user.id}`} prefetch aria-label={`Say hello to ${f.user.displayName}`} className={quietPill}>
                  <Hand className="h-4 w-4" aria-hidden /> <span className="max-[359px]:sr-only">Say hi</span>
                </Link>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      <section className="mb-5" aria-labelledby="friends-all">
        {friends.length > 0 ? (
          <>
            <SectionHeader id="friends-all" title="All friends" count={friends.length} />
            <label className="relative mb-2.5 block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search friends"
                aria-label="Search friends"
                className={cn(
                  "min-h-[2.75rem] w-full rounded-full py-2.5 pl-11 pr-4 text-[15px] outline-none transition placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-primary/40",
                  GLASS,
                  "shadow-none",
                )}
              />
            </label>

            <div role="tablist" aria-label="Friend filters" className={cn("mb-3 flex gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", GLASS, "shadow-none")}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "inline-flex min-h-[2.25rem] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition",
                    tab === t.id ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  <span className={cn("tabular-nums text-[11px]", tab === t.id ? "opacity-70" : "opacity-60")}>{counts[t.id]}</span>
                </button>
              ))}
            </div>

            {visible.length > 0 ? (
              <GlassGroup label="Friends">
                {visible.map((f) => (
                  <FriendRow
                    key={f.user.id}
                    item={f}
                    isNew={now - new Date(f.since).getTime() < 30 * DAY}
                    online={online.has(f.user.id)}
                    onFavorite={toggleFavorite}
                    onRemoved={(id) => setFriends((l) => l.filter((x) => x.user.id !== id))}
                  />
                ))}
              </GlassGroup>
            ) : (
              <p className={cn("rounded-[22px] px-4 py-8 text-center text-sm text-muted-foreground", GLASS)}>
                {query ? `No friends match “${query}”.` : "Nothing here yet."}
              </p>
            )}
          </>
        ) : (
          <div className={cn("rounded-[26px] p-8 text-center", GLASS)}>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserPlus className="h-6 w-6" aria-hidden />
            </span>
            <p className="mt-3 text-[17px] font-semibold">Start building your circle</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              {empty
                ? "Find people you know, or discover creators you'll love — then send a friend request with a note."
                : "Requests you accept will appear here."}
            </p>
            <Link href="/friends/discover" prefetch className={cn(primaryPill, "mt-4")}>
              <Compass className="h-4 w-4" aria-hidden /> Find people
            </Link>
          </div>
        )}
      </section>

      {outgoing.length > 0 ? (
        <section className="mb-5" aria-labelledby="friends-sent">
          <SectionHeader id="friends-sent" title="Sent requests" count={outgoing.length} action={<Send className="h-4 w-4 text-muted-foreground" aria-hidden />} />
          <GlassGroup label="Sent friend requests">
            {outgoing.map((req) => (
              <li key={req.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <Link href={`/u/${req.user.handle}`} prefetch className="flex min-w-0 flex-1 items-center gap-3">
                  <PersonAvatar user={req.user} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{req.user.displayName}</span>
                    <span className="block text-[12.5px] text-muted-foreground">Sent {timeAgo(req.createdAt)} ago</span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => cancel(req)}
                  disabled={busyId === req.id}
                  aria-label={`Cancel friend request to ${req.user.displayName}`}
                  className={quietPill}
                >
                  {busyId === req.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Cancel"}
                </button>
              </li>
            ))}
          </GlassGroup>
        </section>
      ) : null}

      <FriendCelebration
        open={!!celebrating}
        name={celebrating?.displayName ?? ""}
        onStartChat={() => celebrating && router.push(`/messages/new/${celebrating.id}`)}
        onClose={() => setCelebrating(null)}
      />
    </div>
  );
}

/**
 * A friend: tap the person for their profile, Message for a chat, and "More"
 * for the rest (favourite, remove — two-step). Two controls on the row, not
 * four, so the name has room even at 320 px.
 */
function FriendRow({
  item,
  isNew,
  online,
  onFavorite,
  onRemoved,
}: {
  item: FriendItem;
  isNew: boolean;
  online: boolean;
  onFavorite: (id: string, on: boolean) => void;
  onRemoved: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const remove = async () => {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/friends/${item.user.id}`, { method: "DELETE" });
      if (res.ok) onRemoved(item.user.id);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <Link href={`/u/${item.user.handle}`} prefetch={false} className="flex min-w-0 flex-1 items-center gap-3">
          <span className="relative shrink-0">
            <PersonAvatar user={item.user} online={online} />
            {/* on the avatar, not its own column — the name keeps the room (320 px) */}
            {item.unread > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-white dark:ring-slate-900" aria-label={`${item.unread} unread`}>
                {item.unread > 9 ? "9+" : item.unread}
              </span>
            ) : null}
          </span>
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold">{item.user.displayName}</span>
              {item.user.isVerified ? <BadgeCheck className="h-4 w-4 shrink-0 text-blue-500" aria-label="Verified" /> : null}
              {item.favorite ? <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Favourite" /> : null}
              {isNew ? <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-bold text-primary">New</span> : null}
            </span>
            <span className="block truncate text-[12.5px] text-muted-foreground">
              {online ? <span className="font-medium text-emerald-600 dark:text-emerald-400">Online now</span> : item.lastChatAt ? `Chatted ${timeAgo(item.lastChatAt)} ago` : `@${item.user.handle}`}
            </span>
          </span>
        </Link>
        <Link href={`/messages/new/${item.user.id}`} aria-label={`Message ${item.user.displayName}`} className={cn(iconButton, "h-10 w-10 bg-primary/10 text-primary hover:bg-primary/15")}>
          <MessageCircle className="h-[18px] w-[18px]" aria-hidden />
        </Link>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`More for ${item.user.displayName}`} className={cn(iconButton, "h-10 w-10")}>
          <MoreHorizontal className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {open ? (
        <div className="mt-2 flex flex-wrap gap-2 pl-14">
          <button type="button" onClick={() => onFavorite(item.user.id, !item.favorite)} aria-pressed={item.favorite} className={quietPill}>
            <Star className={cn("h-4 w-4", item.favorite && "fill-amber-400 text-amber-400")} aria-hidden />
            {item.favorite ? "Unfavourite" : "Favourite"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className={cn(quietPill, armed && "bg-rose-500/10 text-rose-600 hover:bg-rose-500/15 dark:text-rose-400")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserMinus className="h-4 w-4" aria-hidden />}
            {armed ? "Tap again to remove" : "Remove friend"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

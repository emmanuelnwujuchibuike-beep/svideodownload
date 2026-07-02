"use client";

import {
  Check,
  Compass,
  Hand,
  Loader2,
  MessageCircle,
  Search,
  Sparkles,
  Star,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { FriendCelebration } from "@/features/friends/friend-celebration";
import { FriendOrbit } from "@/features/friends/friend-orbit";
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
type Tab = "all" | "favorites" | "active" | "new";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
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

  const respond = async (req: FriendRequestItem, action: "accept" | "decline") => {
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
        body: JSON.stringify({ action }),
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
  }, [friends, query, tab, now]);

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

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold tracking-[-0.02em]">Friends</h1>

      {initial.viewer && favorites.length > 0 ? (
        <FriendOrbit viewer={initial.viewer} favorites={favorites} />
      ) : null}

      {incoming.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2.5 text-sm font-semibold text-muted-foreground">
            Friend requests{" "}
            <span className="ml-1 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-2 py-0.5 text-[11px] font-bold text-white">
              {incoming.length}
            </span>
          </h2>
          <ul className="space-y-2.5">
            {incoming.map((req) => (
              <li key={req.id} className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur">
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-gradient-to-br from-blue-500/15 to-violet-500/15 blur-2xl" />
                <div className="flex items-start gap-3">
                  <ProfileAvatar user={req.user} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/u/${req.user.handle}`} className="font-semibold hover:underline">
                      {req.user.displayName}
                    </Link>
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      @{req.user.handle} · {timeAgo(req.createdAt)} ago
                    </span>
                    {req.note ? (
                      <p className="mt-1.5 rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2 text-sm leading-relaxed">
                        “{req.note}”
                      </p>
                    ) : null}
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={() => respond(req, "accept")}
                        disabled={busyId === req.id}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-1.5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 disabled:opacity-60"
                      >
                        {busyId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => respond(req, "decline")}
                        disabled={busyId === req.id}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-1.5 text-sm font-semibold text-muted-foreground transition hover:bg-secondary disabled:opacity-60"
                      >
                        <X className="h-4 w-4" /> Decline
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {catchUp.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <Sparkles className="h-4 w-4 text-violet-500 dark:text-violet-300" /> Catch up
          </h2>
          <ul className="space-y-1.5">
            {catchUp.map((f) => (
              <li
                key={f.user.id}
                className="flex items-center gap-3 rounded-2xl border border-violet-500/20 bg-gradient-to-r from-blue-500/[0.06] to-violet-500/[0.06] px-3.5 py-2.5"
              >
                <ProfileAvatar user={f.user} size="sm" />
                <p className="min-w-0 flex-1 text-sm">
                  {f.lastChatAt ? (
                    <>
                      It&apos;s been <strong className="font-semibold">{timeAgo(f.lastChatAt)}</strong> since you chatted with{" "}
                      <strong className="font-semibold">{f.user.displayName}</strong>.
                    </>
                  ) : (
                    <>
                      You and <strong className="font-semibold">{f.user.displayName}</strong> haven&apos;t chatted yet.
                    </>
                  )}
                </p>
                <Link
                  href={`/messages/new/${f.user.id}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-violet-500/25 transition hover:opacity-95"
                >
                  <Hand className="h-3.5 w-3.5" /> Say hello
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {outgoing.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2.5 text-sm font-semibold text-muted-foreground">Sent requests</h2>
          <ul className="space-y-1.5">
            {outgoing.map((req) => (
              <li key={req.id} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-3.5 py-2.5">
                <ProfileAvatar user={req.user} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link href={`/u/${req.user.handle}`} className="text-sm font-semibold hover:underline">
                    {req.user.displayName}
                  </Link>
                  <span className="ml-1.5 text-xs text-muted-foreground">{timeAgo(req.createdAt)} ago</span>
                </div>
                <button
                  type="button"
                  onClick={() => cancel(req)}
                  disabled={busyId === req.id}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-60"
                >
                  {busyId === req.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Cancel"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        {friends.length > 0 ? (
          <>
            {/* Instant search */}
            <label className="relative mb-3 block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search friends…"
                aria-label="Search friends"
                className="w-full rounded-2xl border border-border/70 bg-card/60 py-2.5 pl-10 pr-4 text-sm outline-none backdrop-blur transition placeholder:text-muted-foreground/60 focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
              />
            </label>

            {/* Smart tabs */}
            <div role="tablist" aria-label="Friend filters" className="mb-3 flex flex-wrap gap-1.5">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
                    tab === t.id
                      ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-sm shadow-violet-500/25"
                      : "border border-border/70 bg-card/60 text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {visible.length > 0 ? (
              <ul className="space-y-1.5">
                {visible.map((f) => (
                  <FriendRow
                    key={f.user.id}
                    item={f}
                    isNew={now - new Date(f.since).getTime() < 30 * DAY}
                    onFavorite={toggleFavorite}
                    onRemoved={(id) => setFriends((l) => l.filter((x) => x.user.id !== id))}
                  />
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-border/60 bg-card/60 px-4 py-8 text-center text-sm text-muted-foreground">
                {query ? `No friends match “${query}”.` : "Nothing here yet."}
              </p>
            )}
          </>
        ) : (
          <div className="rounded-3xl border border-border/70 bg-card/70 p-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/20 to-violet-500/20">
              <UserPlus className="h-6 w-6 text-violet-500 dark:text-violet-300" />
            </span>
            <p className="mt-3 font-semibold">Start building meaningful friendships</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              {empty
                ? "Find people you know or discover creators you'll love — then send a friend request with a note."
                : "Requests you accept will appear here."}
            </p>
            <Link
              href="/explore"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95"
            >
              <Compass className="h-4 w-4" /> Discover people
            </Link>
          </div>
        )}
      </section>

      <FriendCelebration
        open={!!celebrating}
        name={celebrating?.displayName ?? ""}
        onStartChat={() => celebrating && router.push(`/messages/new/${celebrating.id}`)}
        onClose={() => setCelebrating(null)}
      />
    </div>
  );
}

/** Friend row: favorite star, unread badge, last-chat recency, Message + two-step remove. */
function FriendRow({
  item,
  isNew,
  onFavorite,
  onRemoved,
}: {
  item: FriendItem;
  isNew: boolean;
  onFavorite: (id: string, on: boolean) => void;
  onRemoved: (id: string) => void;
}) {
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
    <li className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-3.5 py-2.5 transition hover:bg-card">
      <ProfileAvatar user={item.user} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          <Link href={`/u/${item.user.handle}`} className="truncate text-sm font-semibold hover:underline">
            {item.user.displayName}
          </Link>
          {isNew ? (
            <span className="rounded-full bg-gradient-to-r from-blue-500/15 to-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-500 dark:text-violet-300">
              New
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          @{item.user.handle} · {item.lastChatAt ? `chatted ${timeAgo(item.lastChatAt)} ago` : "no chats yet"}
        </p>
      </div>
      {item.unread > 0 ? (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-1.5 text-[10px] font-bold text-white">
          {item.unread > 9 ? "9+" : item.unread}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => onFavorite(item.user.id, !item.favorite)}
        aria-pressed={item.favorite}
        aria-label={item.favorite ? `Unfavorite ${item.user.displayName}` : `Favorite ${item.user.displayName}`}
        className={cn(
          "rounded-lg p-1.5 transition",
          item.favorite
            ? "text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.45)]"
            : "text-muted-foreground/50 hover:bg-secondary hover:text-amber-400",
        )}
      >
        <Star className={cn("h-4 w-4", item.favorite && "fill-current")} />
      </button>
      <Link
        href={`/messages/new/${item.user.id}`}
        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-secondary"
      >
        <MessageCircle className="h-3.5 w-3.5" /> Message
      </Link>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        aria-label={armed ? `Confirm removing ${item.user.displayName}` : `Remove ${item.user.displayName}`}
        className={cn(
          "rounded-lg p-1.5 transition disabled:opacity-60",
          armed ? "bg-rose-500/10 text-rose-500" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
      </button>
    </li>
  );
}

function ProfileAvatar({ user, size = "md" }: { user: FriendProfile; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "h-10 w-10 text-sm" : "h-12 w-12 text-base";
  return user.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.avatarUrl} alt="" className={cn(cls, "shrink-0 rounded-full object-cover ring-2 ring-violet-500/20")} />
  ) : (
    <span className={cn(cls, "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 font-bold text-white")}>
      {user.displayName.charAt(0).toUpperCase()}
    </span>
  );
}

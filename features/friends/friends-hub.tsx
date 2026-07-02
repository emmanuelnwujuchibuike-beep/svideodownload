"use client";

import { Check, Compass, Loader2, MessageCircle, Star, UserMinus, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { timeAgo } from "@/features/notifications/meta";
import type { FriendItem, FriendProfile, FriendRequestItem, FriendsOverview } from "@/lib/social/friends";
import { cn } from "@/lib/utils";

import { FriendCelebration } from "./friend-celebration";

/**
 * /friends hub (Frenz Connect v1): incoming requests (with the sender's note),
 * sent requests, and the friends list. SSR-seeded; every action is optimistic
 * and reverts on error. Accepting fires the celebration with Start Chat.
 */
export function FriendsHub({ initial }: { initial: FriendsOverview }) {
  const router = useRouter();
  const [incoming, setIncoming] = useState<FriendRequestItem[]>(initial.incoming);
  const [outgoing, setOutgoing] = useState<FriendRequestItem[]>(initial.outgoing);
  const [friends, setFriends] = useState<FriendItem[]>(initial.friends);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState<FriendProfile | null>(null);

  const respond = async (req: FriendRequestItem, action: "accept" | "decline") => {
    if (busyId) return;
    setBusyId(req.id);
    const prevIn = incoming;
    const prevFriends = friends;
    setIncoming((l) => l.filter((r) => r.id !== req.id));
    if (action === "accept") {
      setFriends((l) => [{ since: new Date().toISOString(), favorite: false, user: req.user }, ...l]);
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
    const resort = (l: FriendItem[]) =>
      [...l].sort((a, b) => Number(b.favorite) - Number(a.favorite));
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

  const empty = incoming.length === 0 && outgoing.length === 0 && friends.length === 0;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="mb-5 text-2xl font-bold tracking-[-0.02em]">Friends</h1>

      {incoming.length > 0 ? (
        <section className="mb-7">
          <h2 className="mb-2.5 text-sm font-semibold text-muted-foreground">
            Friend requests <span className="ml-1 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-2 py-0.5 text-[11px] font-bold text-white">{incoming.length}</span>
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

      {outgoing.length > 0 ? (
        <section className="mb-7">
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
        <h2 className="mb-2.5 text-sm font-semibold text-muted-foreground">
          {friends.length > 0 ? `Your friends · ${friends.length}` : "Your friends"}
        </h2>
        {friends.length > 0 ? (
          <ul className="space-y-1.5">
            {friends.map((f) => (
              <FriendRow
                key={f.user.id}
                item={f}
                onFavorite={toggleFavorite}
                onRemoved={(id) => setFriends((l) => l.filter((x) => x.user.id !== id))}
              />
            ))}
          </ul>
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

/** Friend row with favorite star, Message + two-step remove. */
function FriendRow({
  item,
  onFavorite,
  onRemoved,
}: {
  item: FriendItem;
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
        <Link href={`/u/${item.user.handle}`} className="text-sm font-semibold hover:underline">
          {item.user.displayName}
        </Link>
        <p className="text-xs text-muted-foreground">@{item.user.handle}</p>
      </div>
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

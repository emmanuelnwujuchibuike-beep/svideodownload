"use client";

import {
  Archive,
  BadgeCheck,
  BookHeart,
  Briefcase,
  CircleDot,
  Compass,
  Crown,
  Hand,
  ListChecks,
  Loader2,
  type LucideIcon,
  Network,
  MessageCircle,
  MoreHorizontal,
  QrCode,
  Search,
  ShieldCheck,
  Send,
  Star,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { sayHiAction } from "@/features/friends/actions";
import { FriendCelebration } from "@/features/friends/friend-celebration";
import { FollowRequestsSection } from "@/features/friends/follow-requests";
import { FriendsToast, useFriendsToast } from "@/features/friends/friends-toast";
import { PendingButton, PendingLink } from "@/features/frenz-ui/pending";
import { RequestCard } from "@/features/friends/request-card";
import { filterRequests, REQUEST_FILTERS, type RequestFilter } from "@/features/friends/request-logic";
import { PeopleSheet } from "@/features/friends/people-sheet";
import { SuggestionDeck } from "@/features/friends/suggestion-deck";
import { afterPageLoad } from "@/features/app-shell/warm-routes";
import { iconButton, PersonAvatar, primaryPill, quietPill } from "@/features/friends/ui";
import { usePresence } from "@/features/friends/use-presence";
import { ChevronRightIcon, UserPlusIcon } from "@/features/frenz-ui/icons";
import { timeAgo } from "@/features/notifications/meta";
import type { FriendItem, FriendProfile, FriendRequestItem, FriendsOverview } from "@/lib/social/friends";
import type { PersonSuggestion } from "@/lib/social/people/engine";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";

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

/* Your people — every way into the rest of Connect, one list (Circles and the Trust Center were header icons before 2026-10-26). */
const PEOPLE_LINKS: { href: string; title: string; sub: string; icon: LucideIcon }[] = [
  // Part 8: the private Social Intelligence dashboard (stages in words, reconnect, archive)
  { href: "/friends/insights", title: "Your connections", sub: "How each friendship is going. Only you see it.", icon: Users },
  // Part 10: the Relationship Manager (lists, tags, bulk actions)
  { href: "/friends/manage", title: "Manage people", sub: "Lists, tags and everyone you follow", icon: ListChecks },
  { href: "/friends/circles", title: "Circles", sub: "Close friends, family and the groups you share with", icon: CircleDot },
  // Part 12: the Professional Network
  { href: "/network", title: "Professional network", sub: "Work, mentors and opportunities", icon: Briefcase },
  // Part 15: your network — graph search, trust explained, growth, history
  { href: "/friends/graph", title: "Your network", sub: "Search it and see how it grew", icon: Network },
  // Part 14: shared memories and life journey
  { href: "/memories", title: "Memories", sub: "Moments you keep, and your life journey", icon: BookHeart },
  // Part 13: creator memberships
  { href: "/members", title: "Members", sub: "Your community and memberships", icon: Crown },
  { href: "/friends/trust", title: "Trust Center", sub: "Who can add you, and how Frenz keeps it safe", icon: ShieldCheck },
];

/*
  The lower sections (favourites, requests, all friends, sent) are not drawn in the design; they take
  the same system as the drawn ones — a solid white card with the frenz-line border (glass only over
  images, owner rule) and the Sora 19px heading Catch up uses.
*/
const CARD = "border border-frenz-line bg-frenz-card";

function CardGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className={cn("divide-y divide-frenz-line/70 overflow-hidden rounded-[24px]", CARD)}>
      {children}
    </ul>
  );
}

function Heading({ title, count, action, id }: { title: string; count?: number; action?: ReactNode; id?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 pb-2.5 pt-1.5">
      <h2 id={id} className="flex items-center gap-2 font-heading text-[19px] font-bold tracking-[-0.4px]">
        {title}
        {count ? <span className="rounded-full bg-frenz-violet/10 px-2 py-px text-[12px] font-bold tabular-nums text-frenz-violet">{count}</span> : null}
      </h2>
      {action}
    </div>
  );
}

const DISCOVER = "/friends/discover";

const ROUND =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-frenz-line bg-frenz-fill/60 text-frenz-ink";
const HI_PILL =
  "flex h-[38px] shrink-0 items-center rounded-[19px] border border-frenz-line bg-frenz-card px-3.5 text-[13px] font-bold text-frenz-ink";

/** "17 Aug" — the design's last-chat date (this year), with the year when it's older. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

export function FriendsHub({
  initial,
  suggestions = [],
  stories = null,
}: {
  initial: FriendsOverview;
  /** The deck's first page (People You May Know); empty → no deck. */
  suggestions?: PersonSuggestion[];
  /** The stories row, server-seeded by the page — drawn under the header. */
  stories?: ReactNode;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const { toast, show, hide } = useFriendsToast();
  // Say hi: one clientId per friend per visit (a retry re-sends the SAME wave), then the row offers the chat
  const hiIds = useRef<Record<string, string>>({});
  const [hiBusy, setHiBusy] = useState<string | null>(null);
  const [hiSent, setHiSent] = useState<Record<string, string>>({});
  const [, startHi] = useTransition();
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
      } else {
        if (action === "accept") setCelebrating(req.user);
        // Profiles cached in the router (6 h) would still show the old state (2026-10-16).
        router.refresh();
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
  // stable (only setters inside), so the memoised rows below don't re-render when the hub does
  const toggleFavorite = useCallback(async (id: string, on: boolean) => {
    const resort = (l: FriendItem[]) => [...l].sort((a, b) => Number(b.favorite) - Number(a.favorite));
    setFriends((l) => resort(l.map((f) => (f.user.id === id ? { ...f, favorite: on } : f))));
    try {
      const res = await fetch(`/api/friends/${id}/favorite`, { method: on ? "POST" : "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setFriends((l) => resort(l.map((f) => (f.user.id === id ? { ...f, favorite: !on } : f))));
    }
  }, []);

  const removeFriend = useCallback((id: string) => setFriends((l) => l.filter((x) => x.user.id !== id)), []);

  const cancel = async (req: FriendRequestItem) => {
    if (busyId) return;
    setBusyId(req.id);
    const prev = outgoing;
    setOutgoing((l) => l.filter((r) => r.id !== req.id));
    try {
      const res = await fetch(`/api/friends/${req.user.id}`, { method: "DELETE" });
      if (!res.ok) setOutgoing(prev);
      else router.refresh();
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
    The header's button is "Your people" now (owner, 2026-10-27): your friends and the requests you've sent, in a
    sheet — search lives on Add friends. Add friends itself is warmed once this page has loaded (afterPageLoad: never
    competing with the page's own load) and again the moment a finger lands on one of its buttons.
  */
  const [peopleOpen, setPeopleOpen] = useState(false);
  useEffect(() => afterPageLoad(() => router.prefetch(DISCOVER)), [router]);
  const warmDiscover = () => router.prefetch(DISCOVER);

  const sayHi = (f: FriendItem) => {
    if (hiBusy) return;
    const clientId = (hiIds.current[f.user.id] ??= crypto.randomUUID());
    setHiBusy(f.user.id);
    startHi(async () => {
      const res = await sayHiAction(f.user.id, clientId);
      setHiBusy(null);
      if (!res.ok) {
        show(res.error, { tone: "error" });
        return;
      }
      setHiSent((m) => ({ ...m, [f.user.id]: res.conversationId ?? "" }));
      show(`Said hi to ${f.user.displayName}`);
    });
  };

  /*
    The Friends redesign (design/friends, 2026-10-26): Sora header, stories, the Suggested-for-you
    deck, the Add friends bar, Your people and Catch up, on the plain page — then the existing
    requests, favourites and friends list. The data, the actions and their optimistic rollbacks are
    unchanged. No bell here: the topbar's NotificationBell is app-wide, and two would double-count.
  */
  return (
    <div className="frenz-ui relative isolate mx-auto w-full max-w-2xl">
      <header className="mb-4 flex items-end justify-between gap-3 pt-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="font-heading text-[34px] font-extrabold leading-[1.05] tracking-[-1.2px]">Friends</h1>
          <p className="text-[14px] font-semibold text-frenz-muted">
            {plural(friends.length, "friend", "friends")}
            {counts.online ? ` · ${counts.online} online` : ""}
            {incoming.length ? ` · ${plural(incoming.length, "request", "requests")}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 pb-1">
          <PendingButton onClick={() => setPeopleOpen(true)} aria-label={`Friends and requests: ${friends.length} friends, ${outgoing.length} sent`} className={cn(ROUND, "relative")}>
            <Users className="h-[20px] w-[20px]" strokeWidth={2.2} aria-hidden />
            {outgoing.length > 0 ? (
              <span aria-hidden className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-frenz-gradient-x px-1 text-[10.5px] font-bold text-white ring-2 ring-frenz-page">
                {outgoing.length > 9 ? "9+" : outgoing.length}
              </span>
            ) : null}
          </PendingButton>
        </div>
      </header>

      {stories}

      {suggestions.length > 0 ? <SuggestionDeck initial={suggestions} variant="panel" seeAllHref={DISCOVER} onWarmSeeAll={warmDiscover} /> : null}

      <div className="mt-3.5 flex gap-2.5">
        <PendingLink
          href={DISCOVER}
          // the whole Add friends page, kept 6 h by the router — the tap opens it instantly (owner, 2026-10-28)
          prefetch
          onPointerDown={warmDiscover}
          className="flex h-[54px] flex-1 items-center justify-center rounded-[27px] bg-frenz-ink font-heading text-[16px] font-bold text-frenz-page shadow-[0_14px_28px_-14px_rgb(18_17_26/0.6)]"
          inner="inline-flex items-center justify-center gap-[9px]"
        >
          <UserPlusIcon size={19} strokeWidth={2.3} />
          Add friends
        </PendingLink>
        {initial.viewer?.handle ? (
          <PendingLink href={`${profilePath(initial.viewer.handle)}/card`} prefetch={false} aria-label="My QR code" className={cn(ROUND, "h-[54px] w-[54px]")}>
            <QrCode className="h-[21px] w-[21px]" strokeWidth={2.1} aria-hidden />
          </PendingLink>
        ) : null}
      </div>

      <h2 className="px-1 pb-2.5 pt-[26px] font-heading text-[19px] font-bold tracking-[-0.4px]">Your people</h2>
      <ul className="mb-1 overflow-hidden rounded-[24px] border border-frenz-line" aria-label="Your people">
        {PEOPLE_LINKS.map((l, i) => (
          <li key={l.href} className={cn(i > 0 && "border-t border-frenz-line/70")}>
            <PendingLink href={l.href} prefetch={false} inner="flex min-h-16 w-full items-center gap-3 px-3.5 py-2.5" className="block transition-colors active:bg-frenz-fill">
              <span aria-hidden className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-frenz-violet/10 text-frenz-violet">
                <l.icon className="h-[19px] w-[19px]" strokeWidth={2.1} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-px text-left">
                <span className="text-[15px] font-bold">{l.title}</span>
                <span className="truncate text-[13px] text-frenz-muted">{l.sub}</span>
              </span>
              <ChevronRightIcon size={15} strokeWidth={2.4} className="shrink-0 text-frenz-muted/70" />
            </PendingLink>
          </li>
        ))}
      </ul>

      {catchUp.length > 0 ? (
        <section className="mb-5" aria-labelledby="friends-catchup">
          <div className="flex items-baseline justify-between px-1 pb-2.5 pt-[26px]">
            <h2 id="friends-catchup" className="font-heading text-[19px] font-bold tracking-[-0.4px]">
              Catch up
            </h2>
            <PendingLink href="/friends/insights" prefetch={false} className="text-[14px] font-bold text-frenz-blue" spinnerSize={14}>
              See all
            </PendingLink>
          </div>
          <ul className="overflow-hidden rounded-[24px] border border-frenz-line" aria-label="Friends to catch up with">
            {catchUp.map((f, i) => {
              const sent = hiSent[f.user.id];
              return (
                <li key={f.user.id} className={cn("flex h-[72px] items-center gap-3 px-3.5", i > 0 && "border-t border-frenz-line/70")}>
                  <Link href={profilePath(f.user.handle)} prefetch={false} className="flex min-w-0 flex-1 items-center gap-3">
                    <PersonAvatar user={f.user} size={44} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[15px] font-bold">{f.user.displayName}</span>
                      <span className="truncate text-[13px] text-frenz-muted" suppressHydrationWarning>
                        {f.lastChatAt ? `Last chat ${shortDate(f.lastChatAt)}` : "You haven't chatted yet"}
                      </span>
                    </span>
                  </Link>
                  {sent !== undefined ? (
                    <PendingLink
                      href={sent ? `/messages/${sent}` : `/messages/new/${f.user.id}`}
                      prefetch={false}
                      aria-label={`Open your chat with ${f.user.displayName}`}
                      className={HI_PILL}
                      inner="inline-flex items-center gap-1.5"
                      spinnerSize={15}
                    >
                      <MessageCircle className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden />
                      <span className="max-[359px]:sr-only">Chat</span>
                    </PendingLink>
                  ) : (
                    <PendingButton
                      onClick={() => sayHi(f)}
                      pending={hiBusy === f.user.id}
                      disabled={!!hiBusy && hiBusy !== f.user.id}
                      aria-label={`Say hi to ${f.user.displayName}`}
                      className={HI_PILL}
                      inner="inline-flex items-center gap-1.5"
                      spinnerSize={15}
                    >
                      <Hand className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden />
                      <span className="max-[359px]:sr-only">Say hi</span>
                    </PendingButton>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <div className="mb-5" />
      )}

      {favorites.length > 0 ? (
        <section className="mb-5" aria-labelledby="friends-favourites">
          <Heading id="friends-favourites" title="Favourites" count={favorites.length} />
          <div className={cn("flex gap-3 overflow-x-auto rounded-[22px] px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", CARD)}>
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
          <Heading id="friends-requests" title="Friend requests" count={incoming.length} />
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
                    requestFilter === f.id ? "bg-foreground text-background" : cn(CARD, "shadow-none text-muted-foreground hover:text-foreground"),
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          ) : null}
          <CardGroup label="Friend requests">
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
          </CardGroup>
        </section>
      ) : null}

      <section className="mb-5" aria-labelledby="friends-all">
        {friends.length > 0 ? (
          <>
            <Heading id="friends-all" title="All friends" count={friends.length} />
            <label className="relative mb-2.5 block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search friends"
                aria-label="Search friends"
                className={cn(
                  "min-h-[2.75rem] w-full rounded-full py-2.5 pl-11 pr-4 text-[15px] outline-none transition placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-primary/40",
                  CARD,
                  "shadow-none",
                )}
              />
            </label>

            <div role="tablist" aria-label="Friend filters" className={cn("mb-3 flex gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", CARD, "shadow-none")}>
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
              <CardGroup label="Friends">
                {visible.map((f) => (
                  <FriendRow
                    key={f.user.id}
                    item={f}
                    isNew={now - new Date(f.since).getTime() < 30 * DAY}
                    online={online.has(f.user.id)}
                    onFavorite={toggleFavorite}
                    onRemoved={removeFriend}
                  />
                ))}
              </CardGroup>
            ) : (
              <p className={cn("rounded-[22px] px-4 py-8 text-center text-sm text-muted-foreground", CARD)}>
                {query ? `No friends match “${query}”.` : "Nothing here yet."}
              </p>
            )}
          </>
        ) : (
          <div className={cn("rounded-[26px] p-8 text-center", CARD)}>
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
          <Heading id="friends-sent" title="Sent requests" count={outgoing.length} action={<Send className="h-4 w-4 text-muted-foreground" aria-hidden />} />
          <CardGroup label="Sent friend requests">
            {outgoing.map((req) => (
              <li key={req.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <Link href={`${profilePath(req.user.handle)}`} prefetch className="flex min-w-0 flex-1 items-center gap-3">
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
          </CardGroup>
        </section>
      ) : null}

      <FriendsToast toast={toast} onHide={hide} />

      <PeopleSheet open={peopleOpen} onClose={() => setPeopleOpen(false)} friends={friends} outgoing={outgoing} busyId={busyId} onCancel={(req) => void cancel(req)} />

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
const FriendRow = memo(function FriendRow({
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

  // Part 8: private, undoable; the friend is not told and nothing about the friendship is deleted
  const archive = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/social/relationship-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendId: item.user.id, action: "archive" }),
      });
      if (res.ok) onRemoved(item.user.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <Link href={`${profilePath(item.user.handle)}`} prefetch={false} className="flex min-w-0 flex-1 items-center gap-3">
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
          {/* Feature 19 Part 7: the friendship's own page (timeline, bucket list, capsules) */}
          <Link href={`/friends/with/${item.user.handle}`} prefetch={false} className={quietPill}>
            <BookHeart className="h-4 w-4 text-primary" aria-hidden /> Our story
          </Link>
          {/* Part 8: archive keeps the history and leaves the list; restore from /friends/insights */}
          <button type="button" onClick={() => void archive()} disabled={busy} className={quietPill}>
            <Archive className="h-4 w-4" aria-hidden /> Archive
          </button>
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
});

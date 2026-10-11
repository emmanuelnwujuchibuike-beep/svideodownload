"use client";

import {
  BadgeCheck,
  CalendarHeart,
  Check,
  Download,
  Eye,
  EyeOff,
  Hourglass,
  Lock,
  MessageCircle,
  Plus,
  Sparkles,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AmbientWash, GLASS, GlassGroup, PersonAvatar, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import type { FriendCapsule, FriendGoal, FriendshipStory } from "@/lib/social/friendship/server";
import { HEALTH_LABEL, HIDEABLE_KINDS, monthLabel, type StoryEvent } from "@/lib/social/friendship/story";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Friend Profile™ — one friendship, told as a story (Feature 19 · Part 7).
 *
 * Only the two friends ever reach this page (the server returns 404 to anyone
 * else), and everything on it is the VIEWER's view: their timeline, their
 * hidden moments, their private health signals. The bucket list and capsules
 * are the only things shared between the two, by design.
 *
 * Calm by intent: health is a quiet line of chips, never a score or a streak
 * to defend. Motion is a fade, and reduced motion removes it.
 */

/**
 * Shared active hours (Part 8), as a time of day in the member's OWN zone, never a chart of
 * someone's habits. The server sends 24 UTC hour counts of your chat, and this names the busiest part of the day.
 */
function activeHours(utc: number[]): string | null {
  const total = utc.reduce((a, b) => a + b, 0);
  if (total < 10) return null;
  const offsetH = -new Date().getTimezoneOffset() / 60;
  const local = Array.from({ length: 24 }, (_, h) => utc[(((h - offsetH) % 24) + 24) % 24] ?? 0);
  const parts: [string, number[]][] = [["in the morning", [5, 6, 7, 8, 9, 10, 11]], ["in the afternoon", [12, 13, 14, 15, 16]], ["in the evening", [17, 18, 19, 20, 21]], ["late at night", [22, 23, 0, 1, 2, 3, 4]]];
  const best = parts.map(([label, hrs]) => [label, hrs.reduce((a, h) => a + (local[h] ?? 0), 0)] as const).sort((a, b) => b[1] - a[1])[0]!;
  return best[0].charAt(0).toUpperCase() + best[0].slice(1);
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function FriendshipPage({ story }: { story: FriendshipStory }) {
  const { friend } = story;
  const first = friend.displayName.split(" ")[0] || friend.displayName;
  const sinceEvent = story.events.find((e) => e.kind === "friends_since");

  const exportJson = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      friend: { handle: friend.handle, name: friend.displayName },
      timeline: story.events,
      insights: story.insights,
      bucketList: story.goals.map((g) => ({ title: g.title, done: g.done, doneAt: g.doneAt })),
      // a sealed capsule leaves without its message, exactly as it is shown
      capsules: story.capsules.map((c) => ({ title: c.title, opensOn: c.unlockAt, from: c.fromViewer ? "you" : first, message: c.message })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `frenz-friendship-${friend.handle}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="relative isolate">
      <AmbientWash />

      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <header className={cn("mb-5 rounded-[26px] p-5 text-center", GLASS)}>
        <div className="mx-auto w-fit">
          <PersonAvatar user={friend} size={52} />
        </div>
        <h1 className="mt-3 flex items-center justify-center gap-1.5 text-[22px] font-extrabold tracking-[-0.03em]">
          <span className="truncate">{friend.displayName}</span>
          {friend.isVerified ? <BadgeCheck className="h-5 w-5 shrink-0 text-blue-500" aria-label="Verified" /> : null}
          {story.favorite ? <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" aria-label="Favourite" /> : null}
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          @{friend.handle}
          {story.label ? <span className="ml-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-semibold text-primary">{story.label}</span> : null}
        </p>
        {sinceEvent ? (
          <p className="mt-3 text-[14px] font-medium">
            Friends since {fmtDate(sinceEvent.at)}
            <span className="text-muted-foreground"> · {story.insights.daysAsFriends.toLocaleString()} days</span>
          </p>
        ) : null}
        {/* Part 8: the stage, in words */}
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          <span className="font-semibold text-foreground/80">{story.stage.label}.</span> {story.stage.line}
        </p>
        {/* Friendship Health: private, informational, never a score */}
        {story.health.length ? (
          <ul className="mt-2.5 flex flex-wrap justify-center gap-1.5" aria-label="How your friendship is going (only you see this)">
            {story.health.map((h) => (
              <li key={h} className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[11.5px] font-medium text-foreground/70 dark:bg-white/[0.07]">
                {HEALTH_LABEL[h]}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex justify-center gap-2">
          <Link href={`/messages/new/${friend.id}`} prefetch={false} className={primaryPill}>
            <MessageCircle className="h-4 w-4" aria-hidden /> Message
          </Link>
          <Link href={`/u/${friend.handle}`} prefetch={false} className={quietPill}>
            <UserRound className="h-4 w-4" aria-hidden /> Profile
          </Link>
          <button type="button" onClick={exportJson} className={quietPill} aria-label="Download our story">
            <Download className="h-4 w-4" aria-hidden /> <span className="max-[359px]:sr-only">Export</span>
          </button>
        </div>
      </header>

      {story.nextAnniversary ? (
        <div className={cn("mb-5 flex items-center gap-3 rounded-[22px] p-3.5", GLASS)}>
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500">
            <CalendarHeart className="h-5 w-5" />
          </span>
          <p className="min-w-0 flex-1 text-[13.5px]">
            <span className="block font-semibold">{story.nextAnniversary.label}</span>
            <span className="text-muted-foreground">on {fmtDate(story.nextAnniversary.at)}</span>
          </p>
        </div>
      ) : null}

      {/* ── insights ─────────────────────────────────────────────────────── */}
      <section className="mb-6" aria-labelledby="fp-insights">
        <SectionHeader id="fp-insights" title="Your friendship in numbers" />
        <dl className={cn("grid grid-cols-2 overflow-hidden rounded-[22px] min-[480px]:grid-cols-4", GLASS)}>
          {[
            ["Messages", formatCompactNumber(story.insights.messages)],
            ["Busiest month", story.insights.mostActiveMonth ? monthLabel(story.insights.mostActiveMonth) : "—"],
            ["Longest streak", story.insights.longestStreakDays ? `${story.insights.longestStreakDays} days` : "—"],
            ["Mutual friends", story.mutuals.disclosed ? String(story.mutuals.total) : "Private"],
            ["You talk most", activeHours(story.hourCounts) ?? "—"],
          ].map(([k, v], i) => (
            <div key={k} className={cn("px-3.5 py-3", i % 2 === 1 && i < 4 && "border-l border-black/[0.06] dark:border-white/[0.07]", i >= 2 && i < 4 && "border-t border-black/[0.06] min-[480px]:border-t-0 min-[480px]:border-l dark:border-white/[0.07]", i === 4 && "col-span-2 border-t border-black/[0.06] min-[480px]:col-span-4 dark:border-white/[0.07]")}>
              <dt className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 truncate text-[17px] font-bold">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Timeline story={story} />

      {/* ── shared in your chat ──────────────────────────────────────────── */}
      {story.media.length ? (
        <section className="mb-6" aria-labelledby="fp-media">
          <SectionHeader
            id="fp-media"
            title="Shared in your chat"
            count={story.media.length}
            action={story.conversationId ? <Link href={`/messages/${story.conversationId}`} prefetch={false} className="text-[12.5px] font-semibold text-primary">Open chat</Link> : undefined}
          />
          <ul className="grid grid-cols-3 gap-1.5">
            {story.media.slice(0, 9).map((m) => (
              <li key={m.id} className="relative aspect-square overflow-hidden rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.thumbnailUrl ?? m.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = "none")}
                />
                {m.kind === "video" ? <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">Video</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── mutual friends (only when their list is public) ─────────────── */}
      {story.mutuals.disclosed && story.mutuals.shown.length ? (
        <section className="mb-6" aria-labelledby="fp-mutuals">
          <SectionHeader id="fp-mutuals" title="Friends you share" count={story.mutuals.total} />
          <ul className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:-mx-4 sm:px-4 [&::-webkit-scrollbar]:hidden">
            {story.mutuals.shown.map((m) => (
              <li key={m.id} className="w-16 shrink-0 text-center">
                <Link href={`/u/${m.handle}`} prefetch={false} className="block">
                  <span className="mx-auto block w-fit">
                    <PersonAvatar user={m} size={52} />
                  </span>
                  <span className="mt-1 block truncate text-[11.5px] font-medium">{m.displayName.split(" ")[0]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── memory vault: what you starred in your chat ─────────────────── */}
      {story.starredCount > 0 && story.conversationId ? (
        <Link href={`/messages/${story.conversationId}`} prefetch={false} className={cn("mb-6 flex items-center gap-3 rounded-[22px] p-3.5", GLASS)}>
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-500">
            <Star className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1 text-[13.5px]">
            <span className="block font-semibold">Memory vault</span>
            <span className="text-muted-foreground">
              {story.starredCount} starred message{story.starredCount === 1 ? "" : "s"} with {first}
            </span>
          </span>
        </Link>
      ) : null}

      <BucketList friendId={friend.id} first={first} initial={story.goals} ready={story.ready.goals} />
      <Capsules friendId={friend.id} first={first} initial={story.capsules} ready={story.ready.capsules} anniversary={story.nextAnniversary?.at ?? null} />
    </div>
  );
}

/* ── the timeline ──────────────────────────────────────────────────────────── */

const KIND_LABEL: Record<string, string> = {
  request_sent: "Friend request",
  you_followed: "When you followed",
  they_followed: "When they followed you",
  first_message: "First conversation",
  messages_100: "100 messages",
  messages_500: "500 messages",
  messages_1000: "1,000 messages",
  first_like_given: "Your first like",
  first_like_received: "Their first like",
  first_comment_given: "Your first comment",
  first_comment_received: "Their first comment",
  first_repost_given: "Your first repost",
  first_repost_received: "Their first repost",
  goal_done: "Bucket list ticks",
};

function Timeline({ story }: { story: FriendshipStory }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set(story.hiddenKinds));
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // hiding happens on the device at once; the server keeps it for next time
  const events = useMemo(() => story.events.filter((e) => !hidden.has(e.kind)), [story.events, hidden]);

  const toggle = async (kind: string, hide: boolean) => {
    setHidden((s) => {
      const n = new Set(s);
      if (hide) n.add(kind);
      else n.delete(kind);
      return n;
    });
    const res = await fetch(`/api/friends/${story.friend.id}/timeline-hidden`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, hidden: hide }),
    }).catch(() => null);
    if (!res?.ok) setNote(res?.status === 503 ? "Hiding moments arrives with the next update. This change lasts until you leave the page." : "Couldn’t save that. Try again.");
  };

  const hiddenHere = [...hidden].filter((k) => KIND_LABEL[k]);
  return (
    <section className="mb-6" aria-labelledby="fp-timeline">
      <SectionHeader
        id="fp-timeline"
        title="Your story"
        action={
          <button type="button" onClick={() => setEditing((v) => !v)} aria-pressed={editing} className="min-h-[2.25rem] text-[12.5px] font-semibold text-primary">
            {editing ? "Done" : "Edit what’s remembered"}
          </button>
        }
      />
      {note ? <p className="mb-2 px-1 text-[12.5px] text-amber-700 dark:text-amber-300">{note}</p> : null}
      {events.length === 0 ? (
        <p className={cn("rounded-[22px] p-4 text-[13.5px] text-muted-foreground", GLASS)}>Your story starts here. Say hello, and it will grow from there.</p>
      ) : (
        <ol className={cn("relative rounded-[22px] py-2", GLASS)}>
          {events.map((e, i) => (
            <TimelineRow key={`${e.kind}-${e.at}-${i}`} event={e} last={i === events.length - 1} editing={editing} onHide={() => void toggle(e.kind, true)} />
          ))}
        </ol>
      )}
      {editing && hiddenHere.length ? (
        <div className="mt-3 px-1">
          <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Hidden from your story (only you see this list)</p>
          <div className="flex flex-wrap gap-1.5">
            {hiddenHere.map((k) => (
              <button key={k} type="button" onClick={() => void toggle(k, false)} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                <Eye className="h-3.5 w-3.5" aria-hidden /> {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TimelineRow({ event, last, editing, onHide }: { event: StoryEvent; last: boolean; editing: boolean; onHide: () => void }) {
  const special = event.kind === "anniversary" || event.kind === "friends_since";
  const canHide = (HIDEABLE_KINDS as readonly string[]).includes(event.kind);
  return (
    <li className="relative flex gap-3 px-4 py-2.5">
      {/* the rail and its dot */}
      <span aria-hidden className="relative flex w-4 shrink-0 justify-center">
        {!last ? <span className="absolute top-4 h-[calc(100%+0.5rem)] w-px bg-black/10 dark:bg-white/10" /> : null}
        <span className={cn("mt-1.5 h-2.5 w-2.5 rounded-full ring-4", special ? "bg-rose-500 ring-rose-500/15" : "bg-primary ring-primary/10")} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug">
          {special && event.kind === "anniversary" ? <Sparkles className="mr-1 inline h-3.5 w-3.5 text-rose-500" aria-hidden /> : null}
          {event.title}
        </p>
        <p className="text-[12px] text-muted-foreground">
          <time dateTime={event.at}>{fmtDate(event.at)}</time>
          {event.detail ? ` · ${event.detail}` : ""}
        </p>
      </div>
      {editing && canHide ? (
        <button type="button" onClick={onHide} aria-label={`Hide “${event.title}” from your story`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
          <EyeOff className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

/* ── the shared bucket list ────────────────────────────────────────────────── */

function BucketList({ friendId, first, initial, ready }: { friendId: string; first: string; initial: FriendGoal[]; ready: boolean }) {
  const [goals, setGoals] = useState(initial);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(ready ? null : "The shared bucket list arrives with the next update.");

  const add = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/friends/${friendId}/goals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { goal?: { id: string; title: string; created_at: string }; error?: string } | null;
    if (res?.ok && j?.goal) {
      setGoals((g) => [...g, { id: j.goal!.id, title: j.goal!.title, done: false, doneAt: null, byViewer: true, createdAt: j.goal!.created_at }]);
      setTitle("");
    } else setError(j?.error ?? "Couldn’t add that.");
    setBusy(false);
  };
  const setDone = async (g: FriendGoal, done: boolean) => {
    setGoals((l) => l.map((x) => (x.id === g.id ? { ...x, done, doneAt: done ? new Date().toISOString() : null } : x)));
    const res = await fetch(`/api/friends/${friendId}/goals`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goalId: g.id, done }) }).catch(() => null);
    if (!res?.ok) setGoals((l) => l.map((x) => (x.id === g.id ? g : x)));
  };
  const remove = async (g: FriendGoal) => {
    setGoals((l) => l.filter((x) => x.id !== g.id));
    const res = await fetch(`/api/friends/${friendId}/goals?goalId=${g.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setGoals((l) => [...l, g]);
  };

  return (
    <section className="mb-6" aria-labelledby="fp-goals">
      <SectionHeader id="fp-goals" title="Bucket list" count={goals.length || undefined} />
      <p className="mb-2 px-1 text-[12.5px] text-muted-foreground">Things to do together. You and {first} both see and edit this list.</p>
      {goals.length ? (
        <GlassGroup label="Bucket list" className="mb-2">
          {goals.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-3.5 py-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={g.done}
                aria-label={g.done ? `Mark “${g.title}” not done` : `Mark “${g.title}” done`}
                onClick={() => void setDone(g, !g.done)}
                className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1", g.done ? "bg-emerald-500 text-white ring-emerald-500" : "ring-black/15 dark:ring-white/20")}
              >
                {g.done ? <Check className="h-4 w-4" aria-hidden /> : null}
              </button>
              <span className={cn("min-w-0 flex-1 text-[14px]", g.done && "text-muted-foreground line-through")}>{g.title}</span>
              <button type="button" onClick={() => void remove(g)} aria-label={`Remove “${g.title}”`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </GlassGroup>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="flex gap-2"
      >
        <label htmlFor="fp-goal" className="sr-only">
          Add something to do together
        </label>
        <input
          id="fp-goal"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          disabled={!ready}
          placeholder="Travel together, finish a course…"
          className="h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-base outline-none ring-1 ring-black/[0.07] focus:ring-2 focus:ring-primary/40 disabled:opacity-60 dark:bg-[hsl(var(--card))] dark:ring-white/10"
        />
        <button type="submit" disabled={!ready || busy || !title.trim()} className={primaryPill} aria-label="Add to the bucket list">
          <Plus className="h-4 w-4" aria-hidden /> <span className="max-[359px]:sr-only">Add</span>
        </button>
      </form>
      {error ? <p className="mt-2 px-1 text-[12.5px] text-muted-foreground">{error}</p> : null}
    </section>
  );
}

/* ── time capsules ─────────────────────────────────────────────────────────── */

function Capsules({ friendId, first, initial, ready, anniversary }: { friendId: string; first: string; initial: FriendCapsule[]; ready: boolean; anniversary: string | null }) {
  const [capsules, setCapsules] = useState(initial);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [when, setWhen] = useState<"1y" | "5y" | "anniversary">(anniversary ? "anniversary" : "1y");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlockAt = () => {
    if (when === "anniversary" && anniversary) return anniversary;
    const d = new Date();
    d.setFullYear(d.getFullYear() + (when === "5y" ? 5 : 1));
    return d.toISOString();
  };
  const seal = async () => {
    if (busy || !title.trim() || !message.trim()) return;
    setBusy(true);
    setError(null);
    const at = unlockAt();
    const res = await fetch(`/api/friends/${friendId}/capsules`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), message: message.trim(), unlockAt: at }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { capsule?: { id: string; title: string; unlock_at: string }; error?: string } | null;
    if (res?.ok && j?.capsule) {
      // sealed: even on this device the message is not kept in view
      setCapsules((c) => [...c, { id: j.capsule!.id, title: j.capsule!.title, message: null, unlockAt: j.capsule!.unlock_at, locked: true, fromViewer: true }].sort((a, b) => a.unlockAt.localeCompare(b.unlockAt)));
      setTitle("");
      setMessage("");
      setOpen(false);
    } else setError(j?.error ?? "Couldn’t seal that.");
    setBusy(false);
  };

  return (
    <section className="mb-4" aria-labelledby="fp-capsules">
      <SectionHeader
        id="fp-capsules"
        title="Time capsules"
        count={capsules.length || undefined}
        action={
          ready ? (
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-h-[2.25rem] text-[12.5px] font-semibold text-primary">
              {open ? "Cancel" : "Seal one"}
            </button>
          ) : undefined
        }
      />
      {!ready ? <p className="mb-2 px-1 text-[12.5px] text-muted-foreground">Capsules for friends arrive with the next update.</p> : null}
      {open ? (
        <div className={cn("mb-3 space-y-2 rounded-[22px] p-3.5", GLASS)}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Title" aria-label="Capsule title" className="h-11 w-full rounded-2xl bg-black/[0.03] px-3.5 text-base outline-none ring-1 ring-black/[0.06] focus:ring-2 focus:ring-primary/40 dark:bg-white/[0.04] dark:ring-white/10" />
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={4} placeholder={`A message for ${first} to open later…`} aria-label="Capsule message" className="w-full resize-y rounded-2xl bg-black/[0.03] p-3.5 text-base outline-none ring-1 ring-black/[0.06] focus:ring-2 focus:ring-primary/40 dark:bg-white/[0.04] dark:ring-white/10" />
          <div role="radiogroup" aria-label="Opens" className="flex flex-wrap gap-1.5">
            {([...(anniversary ? [["anniversary", "On your next anniversary"]] : []), ["1y", "In 1 year"], ["5y", "In 5 years"]] as [typeof when, string][]).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={when === k} onClick={() => setWhen(k)} className={cn("min-h-[2.25rem] rounded-full px-3 text-[12.5px] font-semibold", when === k ? "bg-foreground text-background" : "bg-black/[0.04] dark:bg-white/[0.07]")}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void seal()} disabled={busy || !title.trim() || !message.trim()} className={primaryPill}>
            <Lock className="h-4 w-4" aria-hidden /> Seal for {first}
          </button>
          <p className="text-[12px] text-muted-foreground">Nobody can read it before it opens, not even you.</p>
          {error ? <p className="text-[12.5px] text-rose-600">{error}</p> : null}
        </div>
      ) : null}
      {capsules.length ? (
        <GlassGroup label="Time capsules">
          {capsules.map((c) => (
            <li key={c.id} className="flex gap-3 px-3.5 py-3">
              <span aria-hidden className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", c.locked ? "bg-black/[0.04] text-muted-foreground dark:bg-white/[0.07]" : "bg-primary/10 text-primary")}>
                {c.locked ? <Hourglass className="h-[18px] w-[18px]" /> : <Sparkles className="h-[18px] w-[18px]" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{c.title}</p>
                <p className="text-[12px] text-muted-foreground">
                  {c.fromViewer ? `From you to ${first}` : `From ${first}`} · {c.locked ? `opens ${fmtDate(c.unlockAt)}` : `opened ${fmtDate(c.unlockAt)}`}
                </p>
                {c.message ? <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed">{c.message}</p> : null}
              </div>
            </li>
          ))}
        </GlassGroup>
      ) : null}
    </section>
  );
}

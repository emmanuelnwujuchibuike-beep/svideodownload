"use client";

import { RotateCw, Search, UserCheck, UserPlus, Users, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { usePresence } from "@/features/friends/use-presence";
import { toggleFollow, useFollowState } from "@/lib/social/follow-store";
import type { SearchPerson } from "@/lib/social/search";
import type { SuggestedCreator } from "@/lib/social/suggest";
import { cn, formatCompactNumber } from "@/lib/utils";

type Person = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  followersCount: number;
  isFollowing?: boolean;
};

/**
 * "Add friends" — people discovery.
 *
 * Rebuilt against the owner's reference (`public/friendspage.jpg`). The data
 * path is untouched: suggestions are still server-rendered so the page opens
 * with content, search still hits `/api/search?type=people` behind a debounce,
 * and every Follow still goes through the shared `follow-store` — so following
 * someone here updates their card on the feed, the profile and /search at the
 * same instant, and never re-offers "Follow".
 *
 * What changed is the presentation: a real search surface instead of a tinted
 * input, one grouped list instead of floating rows, a genuine presence dot, a
 * skeleton that matches the final row exactly, and honest empty/error states.
 *
 * ── 🔴 NOT ADDED, DELIBERATELY ───────────────────────────────────────────
 * The reference shows a "See all ›" affordance and a "Popular creator" chip.
 * Neither exists in this product: there is no all-suggestions route, and no
 * field that honestly says "popular" — a follower-count threshold would be a
 * number invented to justify a badge. The brief rules both out explicitly
 * ("do NOT invent See all", "add random badges"), so they are absent rather
 * than faked.
 */
export function FriendsDiscover({ initialSuggestions }: { initialSuggestions: SuggestedCreator[] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchPerson[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults(null);
      setLoading(false);
      setFailed(false);
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    setLoading(true);
    setFailed(false);
    if (timer.current) clearTimeout(timer.current);
    // Typing sends nothing; one request per pause, as before.
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?type=people&q=${encodeURIComponent(term)}`);
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { people?: SearchPerson[] };
        setResults(j.people ?? []);
      } catch {
        // Distinguished from "no matches": one is the network, the other is an
        // answer, and telling a user "no one matches" when the request failed
        // is a lie the retry button exists to avoid.
        setResults([]);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const searching = results !== null;
  const people: Person[] = searching ? (results ?? []) : initialSuggestions;

  return (
    <div>
      {/*
        The search surface. Sticky under the topbar so it stays reachable down a
        long list, on an OPAQUE ground — the previous version used
        `backdrop-blur-xl` across the full width, which is a large-area blur
        repainted on every scroll frame for an effect nothing shows through.
      */}
      <div className="sticky top-[calc(4rem+var(--frenz-safe-top)+var(--frenz-announce-h,0px))] z-10 -mx-3 mb-4 bg-background px-3 pb-2 pt-1 sm:-mx-4 sm:px-4">
        <div className="relative">
          <label htmlFor="friends-search" className="sr-only">
            Search people by name or handle
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 h-[20px] w-[20px] -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="friends-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Search people by name or @handle"
            /*
              `text-base` (16px) is not a style choice — iOS Safari zooms the
              page in on a focused input below 16px, which is the usual cause of
              a search field that "breaks the layout" on iPhone. The native
              WebKit clear glyph is hidden because we draw our own.
            */
            className="frnd-field h-[54px] w-full rounded-[20px] border border-border/70 bg-card pl-12 pr-11 text-base font-medium text-foreground outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="button"
            onClick={() => setQ("")}
            tabIndex={q ? 0 : -1}
            aria-hidden={!q}
            aria-label="Clear search"
            /* Absolutely positioned, so appearing and disappearing can never
               change the field's width mid-type. */
            className={cn(
              "absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-opacity duration-150",
              q ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mb-2.5 flex items-center gap-2.5 px-1">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
          <Users className="h-[17px] w-[17px]" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-[-0.01em]">
          {searching ? (loading ? "Searching…" : "Results") : "People you may know"}
        </h2>
        {searching && !loading && people.length > 0 ? (
          <span className="shrink-0 text-[13px] font-medium text-muted-foreground tabular-nums">
            {people.length}
          </span>
        ) : null}
      </div>

      {loading && people.length === 0 ? (
        <SkeletonRows />
      ) : failed ? (
        <ErrorState onRetry={() => setQ((v) => `${v} `.trim())} />
      ) : people.length === 0 ? (
        <EmptyState searching={searching} query={q} />
      ) : (
        /*
          ONE grouped surface with hairline dividers, rather than a floating
          card per person. Fourteen stacked cards is what made the old list read
          as heavy; separation here comes from a divider and rhythm, which is
          also one paint instead of fourteen.
        */
        <ul className="overflow-hidden rounded-[20px] border border-border/70 bg-card">
          {people.map((p, i) => (
            <PersonRow key={p.id} person={p} first={i === 0} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Row
   ──────────────────────────────────────────────────────────────────────── */

function PersonRow({ person, first }: { person: Person; first: boolean }) {
  const online = usePresence();
  return (
    <li
      className={cn(
        // A fixed row height keeps every avatar and button on the same line
        // regardless of name length — the "rows align perfectly" requirement.
        "flex items-center gap-3 px-3 py-2.5 transition-colors duration-150",
        !first && "border-t border-border/50",
        "hover:bg-secondary/40",
      )}
    >
      <Link href={`/u/${person.handle}`} prefetch className="relative shrink-0">
        <PersonAvatar person={person} />
        {/*
          Real presence, from the channel this app already joins app-wide
          (`PresenceTracker` in the signed-in shell) — not a fabricated dot and
          not a new query. Absent from the set simply means no dot.
        */}
        {online.has(person.id) ? (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[2.5px] border-card bg-emerald-500"
            aria-hidden
          />
        ) : null}
        <span className="sr-only">{online.has(person.id) ? `${person.displayName} is online` : ""}</span>
      </Link>

      <Link href={`/u/${person.handle}`} prefetch className="min-w-0 flex-1 py-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{person.displayName}</span>
          {person.isVerified ? <VerifiedTick size="sm" className="h-[15px] w-[15px] shrink-0" /> : null}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
          @{person.handle} · {formatCompactNumber(person.followersCount)} followers
        </span>
      </Link>

      <FollowChip id={person.id} name={person.displayName} initial={person.isFollowing ?? false} />
    </li>
  );
}

/**
 * The avatar, with a STABLE fallback.
 *
 * 🔴 The initials tint is derived from the user's id, not chosen at random —
 * so the same person is the same colour on every render, every device and
 * every visit, which is what makes an initials avatar recognisable rather than
 * decorative. Six brand-adjacent gradients; nothing outside the palette.
 */
function PersonAvatar({ person }: { person: Person }) {
  const [broken, setBroken] = useState(false);
  if (person.avatarUrl && !broken) {
    return (
      <Image
        src={person.avatarUrl}
        alt=""
        width={52}
        height={52}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="h-[52px] w-[52px] rounded-full bg-secondary object-cover ring-1 ring-inset ring-border/60"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-[52px] w-[52px] items-center justify-center rounded-full bg-gradient-to-br text-[19px] font-bold text-white",
        AVATAR_TINTS[tintFor(person.id)],
      )}
    >
      {person.displayName.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

const AVATAR_TINTS = [
  "from-blue-500 to-indigo-600",
  "from-indigo-500 to-violet-600",
  "from-violet-500 to-purple-600",
  "from-sky-500 to-blue-600",
  "from-purple-500 to-fuchsia-600",
  "from-cyan-500 to-sky-600",
] as const;

/** FNV-1a over the id — stable everywhere, and not security-sensitive. */
function tintFor(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % AVATAR_TINTS.length;
}

/**
 * Follow / Following.
 *
 * Same shared store as everywhere else, so the state is optimistic and app-wide.
 * The accessible name carries the person and the state — "Follow Chris" becomes
 * "Following Chris" — because a pressed-state colour change is not something a
 * screen reader can see.
 */
function FollowChip({ id, name, initial }: { id: string; name: string; initial: boolean }) {
  const following = useFollowState(id, initial);
  return (
    <button
      type="button"
      onClick={() => void toggleFollow(id, !following)}
      aria-pressed={following}
      aria-label={following ? `Following ${name}. Tap to unfollow.` : `Follow ${name}`}
      className={cn(
        // 36px tall inside a 68px row: a comfortable target that does not
        // dominate the row the way a full-height button would.
        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold",
        "transition-transform duration-150 active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
        following
          ? "bg-secondary text-foreground ring-1 ring-inset ring-border/60"
          : "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-[0_4px_12px_-4px_rgba(99,102,241,0.6)]",
      )}
    >
      {following ? (
        <>
          <UserCheck className="h-4 w-4" aria-hidden /> Following
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4" aria-hidden /> Follow
        </>
      )}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   States
   ──────────────────────────────────────────────────────────────────────── */

/** Identical geometry to a real row, so nothing moves when people arrive. */
function SkeletonRows() {
  return (
    <ul
      role="status"
      aria-live="polite"
      className="overflow-hidden rounded-[20px] border border-border/70 bg-card"
    >
      <li className="sr-only">Loading people…</li>
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className={cn("flex items-center gap-3 px-3 py-2.5", i > 0 && "border-t border-border/50")}
          aria-hidden
        >
          <span className="h-[52px] w-[52px] shrink-0 rounded-full bg-secondary shimmer" />
          <span className="flex-1 space-y-2 py-1">
            <span className="block h-3.5 w-32 rounded bg-secondary shimmer" />
            <span className="block h-3 w-24 rounded bg-secondary shimmer" />
          </span>
          <span className="h-9 w-[92px] shrink-0 rounded-full bg-secondary shimmer" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ searching, query }: { searching: boolean; query: string }) {
  return (
    <div className="flex flex-col items-center rounded-[20px] border border-border/70 bg-card px-6 py-14 text-center">
      <span
        aria-hidden
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground"
      >
        <Users className="h-6 w-6" />
      </span>
      <p className="text-[15.5px] font-semibold">{searching ? "No users found" : "No new people to discover"}</p>
      <p className="mt-1.5 max-w-xs text-[13.5px] text-muted-foreground">
        {searching
          ? `Nothing matched “${query.trim()}”. Try another name or @handle.`
          : "We’ll show you more suggestions as your Frenzsave community grows."}
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-[20px] border border-border/70 bg-card px-6 py-14 text-center"
    >
      <p className="text-[15.5px] font-semibold">Couldn&rsquo;t load suggestions</p>
      <p className="mt-1.5 max-w-xs text-[13.5px] text-muted-foreground">
        Check your connection — everything else on this page still works.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.97] motion-reduce:transition-none"
      >
        <RotateCw className="h-4 w-4" aria-hidden /> Try again
      </button>
    </div>
  );
}

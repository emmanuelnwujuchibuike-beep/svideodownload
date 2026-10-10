"use client";

import { BookUser, Check, ChevronRight, Loader2, QrCode, RotateCw, Search, Send, UserCheck, UserPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { AmbientWash, GLASS, GlassGroup, GlassIconLink, PersonAvatar, primaryPill, SectionHeader } from "@/features/friends/ui";
import { usePresence } from "@/features/friends/use-presence";
import { attributionLink, reportReferralShared, shareOrCopy } from "@/lib/referrals/share-client";
import type { FollowSource } from "@/lib/social/follow-policy";
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
 * The data path is unchanged: suggestions are server-rendered so the page opens
 * with content, search hits `/api/search?type=people` behind a debounce, and
 * every Follow goes through the shared `follow-store`, so following someone
 * here updates their card on the feed, the profile and /search at the same
 * instant.
 *
 * 2026-10-10 glass redesign (owner: "glassy professional, lightweight social
 * platform"): the shared features/friends/ui.tsx language (ambient wash,
 * frosted grouped list, the cached CDN avatar every list uses), plus an Invite
 * card that reuses the ONE attribution link (lib/referrals/share-client) and a
 * way to the existing QR card (/u/<handle>/card). Nothing new on the server.
 *
 * ── 🔴 NOT ADDED, DELIBERATELY ───────────────────────────────────────────
 * The original reference showed "See all ›" and a "Popular creator" chip.
 * Neither exists in this product: there is no all-suggestions route, and no
 * field that honestly says "popular". A follower-count threshold would be a
 * number invented to justify a badge, so both are absent rather than faked.
 */
export function FriendsDiscover({ initialSuggestions, handle = null }: { initialSuggestions: SuggestedCreator[]; handle?: string | null }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchPerson[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // "Try again" bumps this. The old retry set q to the SAME string, which React
  // bails out of, so the effect never re-ran and the button did nothing.
  const [attempt, setAttempt] = useState(0);
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
    // Typing sends nothing; one request per pause.
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?type=people&q=${encodeURIComponent(term)}`);
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { people?: SearchPerson[] };
        setResults(j.people ?? []);
      } catch {
        // A failed request is not "no matches". Telling a user "no one matches"
        // when the request failed would be a lie, which is why there is a retry.
        setResults([]);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, attempt]);

  const searching = results !== null;
  const people: Person[] = searching ? (results ?? []) : initialSuggestions;

  return (
    <div className="relative isolate">
      <AmbientWash />

      <header className="mb-4 flex items-start justify-between gap-3 px-1 pt-1">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.75rem,7.5vw,2.125rem)] font-extrabold leading-none tracking-[-0.04em]">Add friends</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">Find people you know, or invite them to Frenz.</p>
        </div>
        {handle ? (
          <GlassIconLink href={`/u/${handle}/card`} label="My QR card">
            <QrCode className="h-5 w-5" aria-hidden />
          </GlassIconLink>
        ) : null}
      </header>

      {/*
        The search bar sticks under the topbar with no wrapper background (an opaque band cut the ambient wash) and no
        backdrop blur. A full-width blur on a sticky bar repaints a large area on
        every scroll frame. The field gets its glass look from a solid fill, a
        hairline ring and a soft shadow.
      */}
      <div className="sticky top-[calc(4rem+var(--frenz-safe-top)+var(--frenz-announce-h,0px))] z-10 mb-4 pb-2 pt-1">
        <div className="relative">
          <label htmlFor="friends-search" className="sr-only">
            Search people by name or handle
          </label>
          <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-[19px] w-[19px] -translate-y-1/2 text-muted-foreground" />
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
            placeholder="Search name or @handle"
            /*
              The 16px size (`text-base`) is not a style choice. iOS Safari zooms
              the page in on a focused input below 16px. The native WebKit clear
              glyph is hidden because we draw our own.
            */
            className="frnd-field h-[50px] w-full rounded-full bg-white pl-11 pr-11 text-base font-medium text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-14px_rgba(15,23,42,0.22)] outline-none ring-1 ring-black/[0.07] transition-shadow focus:ring-2 focus:ring-primary/40 dark:bg-[hsl(var(--card))] dark:ring-white/10 [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="button"
            onClick={() => setQ("")}
            tabIndex={q ? 0 : -1}
            aria-hidden={!q}
            aria-label="Clear search"
            /* Absolutely positioned, so appearing and disappearing never
               changes the field's width while the user types. */
            className={cn(
              "absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/[0.05] text-muted-foreground transition-opacity duration-150 dark:bg-white/10",
              q ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {searching ? null : (
        <>
          <ContactsLink />
          <InviteCard />
        </>
      )}

      <SectionHeader
        title={searching ? (loading ? "Searching…" : "Results") : "People you may know"}
        count={searching && !loading && !failed ? people.length : undefined}
      />

      {loading && people.length === 0 ? (
        <SkeletonRows />
      ) : failed ? (
        <ErrorState onRetry={() => setAttempt((n) => n + 1)} />
      ) : people.length === 0 ? (
        <EmptyState searching={searching} query={q} />
      ) : (
        /*
          One grouped glass card with hairline dividers instead of a card per
          person. It reads lighter and is one paint instead of fourteen.
        */
        <GlassGroup label={searching ? "Search results" : "Suggested people"}>
          {people.map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
        </GlassGroup>
      )}
    </div>
  );
}

/** The way into Contact Discovery (Part 5): contacts are read and hashed on the device, on that page. */
function ContactsLink() {
  return (
    <Link href="/friends/contacts" prefetch={false} className={cn("mb-3 flex items-center gap-3 rounded-[22px] p-3.5 transition active:scale-[0.99] motion-reduce:active:scale-100", GLASS)}>
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
        <BookUser className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-semibold leading-tight">Find friends from your contacts</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">Private: your contacts never leave this device.</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/**
 * Invite: shares the member's ONE attribution link, the same `/r/<token>` that
 * the Rewards page and the referral banner share, through the native share
 * sheet or the clipboard. Admins are told about the share exactly as they are
 * for a share from Rewards.
 */
function InviteCard() {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">("idle");
  const invite = async () => {
    if (state === "busy") return;
    setState("busy");
    const url = (await attributionLink("app", "app")) ?? window.location.origin;
    const out = await shareOrCopy(url, "Join me on Frenz");
    if (out === "copied" || out === "shared") reportReferralShared(out, "friends");
    setState(out === "copied" ? "copied" : out === "failed" ? "failed" : "idle");
  };
  return (
    <div className={cn("mb-5 flex items-center gap-3 rounded-[22px] p-3.5", GLASS)}>
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-[0_6px_16px_-8px_rgba(99,102,241,0.8)]">
        <Users className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold leading-tight">Invite your friends</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground" aria-live="polite">
          {state === "copied" ? "Link copied. Paste it anywhere." : state === "failed" ? "Couldn’t share. Try again." : "Frenz is better with people you know."}
        </p>
      </div>
      <button type="button" onClick={() => void invite()} disabled={state === "busy"} aria-label="Invite friends" className={primaryPill}>
        {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : state === "copied" ? <Check className="h-4 w-4" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        <span className="max-[359px]:sr-only">Invite</span>
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Row
   ──────────────────────────────────────────────────────────────────────── */

function PersonRow({ person }: { person: Person }) {
  const online = usePresence();
  const isOnline = online.has(person.id);
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-150 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
      {/* Real presence, from the channel the signed-in shell already joins. Not a made-up dot. */}
      <Link href={`/u/${person.handle}`} prefetch={false} aria-label={isOnline ? `${person.displayName}, online` : person.displayName} className="shrink-0">
        <PersonAvatar user={person} size={52} online={isOnline} />
      </Link>

      <Link href={`/u/${person.handle}`} prefetch={false} className="min-w-0 flex-1 py-0.5">
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
 * Follow / Following.
 *
 * Same shared store as everywhere else, so the state is optimistic and app-wide.
 * The accessible name carries the person and the state ("Follow Chris" becomes
 * "Following Chris"), because a screen reader cannot see a colour change.
 */
export function FollowChip({ id, name, initial, source = "suggestion" }: { id: string; name: string; initial: boolean; source?: FollowSource }) {
  const following = useFollowState(id, initial);
  return (
    <button
      type="button"
      onClick={() => void toggleFollow(id, !following, source)}
      aria-pressed={following}
      aria-label={following ? `Following ${name}. Tap to unfollow.` : `Follow ${name}`}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold max-[359px]:px-2.5",
        "transition-transform duration-150 active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
        following
          ? "bg-black/[0.05] text-foreground/80 dark:bg-white/[0.08]"
          : "bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_hsl(var(--primary)/0.7)]",
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

/** The same geometry as a real row, so nothing moves when people arrive. */
function SkeletonRows() {
  return (
    <ul role="status" aria-live="polite" className={cn("divide-y divide-black/[0.06] overflow-hidden rounded-[22px] dark:divide-white/[0.07]", GLASS)}>
      <li className="sr-only">Loading people…</li>
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-3.5 py-2.5" aria-hidden>
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
    <div className={cn("flex flex-col items-center rounded-[22px] px-6 py-14 text-center", GLASS)}>
      <span aria-hidden className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Users className="h-6 w-6" />
      </span>
      <p className="text-[15.5px] font-semibold">{searching ? "No users found" : "No new people to discover"}</p>
      <p className="mt-1.5 max-w-xs text-[13.5px] text-muted-foreground">
        {searching
          ? `Nothing matched “${query.trim()}”. Try another name or @handle.`
          : "We’ll show you more suggestions as your Frenz community grows. Inviting friends is the fastest way."}
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-[22px] px-6 py-14 text-center", GLASS)}>
      <p className="text-[15.5px] font-semibold">Couldn&rsquo;t search right now</p>
      <p className="mt-1.5 max-w-xs text-[13.5px] text-muted-foreground">Check your connection. Everything else on this page still works.</p>
      <button type="button" onClick={onRetry} className={cn(primaryPill, "mt-5")}>
        <RotateCw className="h-4 w-4" aria-hidden /> Try again
      </button>
    </div>
  );
}

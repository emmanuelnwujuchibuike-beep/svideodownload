"use client";

import { BookUser, Check, QrCode, RotateCw, Send, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { FollowChip } from "@/features/friends/follow-chip";
import { PendingButton, PendingLink } from "@/features/frenz-ui/pending";
import { PeopleYouMayKnow } from "@/features/friends/people-you-may-know";
import { SuggestionDeck } from "@/features/friends/suggestion-deck";
import { PersonAvatar, primaryPill } from "@/features/friends/ui";
import { usePresence } from "@/features/friends/use-presence";
import { ChevronLeftIcon, SearchIcon } from "@/features/frenz-ui/icons";
import { attributionLink, reportReferralShared, shareOrCopy } from "@/lib/referrals/share-client";
import type { PersonSuggestion } from "@/lib/social/people/engine";
import { profilePath } from "@/lib/social/profile-url";
import type { SearchPerson } from "@/lib/social/search";
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

/** The deck takes the first page of the same server-rendered list; it fetches the rest itself. */
const DECK_FIRST = 10;

const ROUND =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-frenz-line bg-frenz-fill/60 text-frenz-ink";
const TILE = "flex min-h-[132px] flex-col items-start gap-2 rounded-[24px] border border-frenz-line bg-frenz-card p-4 text-left";
const LIST = "divide-y divide-frenz-line/70 overflow-hidden rounded-[24px] border border-frenz-line bg-frenz-card";

/**
 * "Add friends" — people discovery (design/friends AddFriends.dc.html, 2026-10-26).
 *
 * Layout: ‹ Friends + the QR card, the large title, the Suggestions deck (the shared SuggestionDeck,
 * hero variant: TAP ONLY — Skip, Add, View profile; the design's swipe hint and ADD/SKIP badges are
 * not built), the search field, From contacts + Invite friends as two white tiles, then People you
 * may know with its filters.
 *
 * The data path is unchanged: suggestions are server-rendered so the page opens with content, search
 * hits `/api/search?type=people` behind a debounce, Follow goes through the shared `follow-store`,
 * Invite shares the ONE attribution link (lib/referrals/share-client). While searching, the deck and
 * the tiles step aside so the results sit under the field.
 *
 * Glass only on the deck's gradient panel (owner rule: glass over images/colour only); every white
 * surface is a solid card with the frenz-line border.
 */
export function FriendsDiscover({ initialSuggestions, handle = null }: { initialSuggestions: PersonSuggestion[]; handle?: string | null }) {
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
        // A failed request is not "no matches" — hence the retry.
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

  const searching = q.trim().length > 0;
  const people: Person[] = results ?? [];

  return (
    <div className="frenz-ui">
      <div className="flex items-center justify-between gap-3 pt-1">
        <PendingLink href="/friends" prefetch={false} className="-ml-1.5 flex h-11 items-center rounded-full pl-1 pr-2 text-[16px] font-semibold text-frenz-violet" inner="inline-flex items-center gap-1" spinnerSize={16}>
          <ChevronLeftIcon size={20} strokeWidth={2.4} />
          Friends
        </PendingLink>
        {handle ? (
          <PendingLink href={`${profilePath(handle)}/card`} prefetch={false} aria-label="My QR card" className={ROUND}>
            <QrCode className="h-[20px] w-[20px]" strokeWidth={2.1} aria-hidden />
          </PendingLink>
        ) : null}
      </div>

      <header className="mb-4 mt-1">
        <h1 className="font-heading text-[34px] font-extrabold leading-[1.05] tracking-[-1.2px]">Add friends</h1>
        <p className="mt-1.5 text-[15px] leading-snug text-frenz-muted">Go through suggestions, or find someone yourself.</p>
      </header>

      {!searching && initialSuggestions.length > 0 ? <SuggestionDeck initial={initialSuggestions.slice(0, DECK_FIRST)} variant="hero" /> : null}

      <label className="relative mt-4 block">
        <span className="sr-only">Search people by name or handle</span>
        <SearchIcon size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-frenz-muted" />
        <input
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
          /* 16px: iOS Safari zooms in on a focused input below it. The native clear glyph is ours instead. */
          className="h-[52px] w-full rounded-[26px] bg-frenz-fill pl-12 pr-12 text-base text-frenz-ink outline-none transition-shadow placeholder:text-frenz-muted focus:ring-2 focus:ring-frenz-violet/35 [&::-webkit-search-cancel-button]:hidden"
        />
        <button
          type="button"
          onClick={() => setQ("")}
          tabIndex={q ? 0 : -1}
          aria-hidden={!q}
          aria-label="Clear search"
          className={cn(
            "absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-frenz-ink/[0.06] text-frenz-muted transition-opacity duration-150",
            q ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </label>

      {searching ? (
        <section aria-labelledby="discover-results" className="mt-5">
          <h2 id="discover-results" className="px-1 pb-2.5 font-heading text-[19px] font-bold tracking-[-0.4px]">
            {loading ? "Searching…" : failed ? "Results" : `Results${people.length ? ` · ${people.length}` : ""}`}
          </h2>
          {loading && people.length === 0 ? (
            <SkeletonRows />
          ) : failed ? (
            <ErrorState onRetry={() => setAttempt((n) => n + 1)} />
          ) : people.length === 0 ? (
            <EmptyState query={q} />
          ) : (
            <ul aria-label="Search results" className={LIST}>
              {people.map((p) => (
                <PersonRow key={p.id} person={p} />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            <ContactsTile />
            <InviteTile />
          </div>
          <PeopleYouMayKnow initial={initialSuggestions} />
        </>
      )}
    </div>
  );
}

/** The way into Contact Discovery (Part 5): contacts are read and hashed on the device, on that page. */
function ContactsTile() {
  return (
    <PendingLink href="/friends/contacts" prefetch={false} className={TILE} inner="flex flex-col items-start gap-2">
      <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-frenz-violet/10 text-frenz-violet">
        <BookUser className="h-[21px] w-[21px]" strokeWidth={2.1} />
      </span>
      <span className="mt-1 font-heading text-[16px] font-bold tracking-[-0.2px] text-frenz-ink">From contacts</span>
      <span className="text-[13px] leading-snug text-frenz-muted">Private. Contacts never leave this device.</span>
    </PendingLink>
  );
}

/**
 * Invite: shares the member's ONE attribution link — the same `/r/<token>` the Rewards page and the
 * referral banner share — through the native share sheet or the clipboard. Admins are told about the
 * share exactly as for a share from Rewards.
 */
function InviteTile() {
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
    <PendingButton onClick={() => void invite()} pending={state === "busy"} className={TILE} inner="flex flex-col items-start gap-2">
      <span aria-hidden className="frenz-icon-glass text-frenz-violet flex h-11 w-11 items-center justify-center rounded-[14px]">
        {state === "copied" ? <Check className="h-[20px] w-[20px]" strokeWidth={2.4} /> : <Send className="h-[20px] w-[20px]" strokeWidth={2.2} />}
      </span>
      <span className="mt-1 font-heading text-[16px] font-bold tracking-[-0.2px] text-frenz-ink">Invite friends</span>
      <span className="text-[13px] leading-snug text-frenz-muted" aria-live="polite">
        {state === "copied" ? "Link copied. Paste it anywhere." : state === "failed" ? "Couldn’t share. Try again." : "Frenz is better with people you know."}
      </span>
    </PendingButton>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Row
   ──────────────────────────────────────────────────────────────────────── */

function PersonRow({ person }: { person: Person }) {
  const online = usePresence();
  const isOnline = online.has(person.id);
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      {/* Real presence, from the channel the signed-in shell already joins. Not a made-up dot. */}
      <PendingLink
        href={profilePath(person.handle)}
        prefetch={false}
        aria-label={isOnline ? `${person.displayName}, online` : person.displayName}
        className="min-w-0 flex-1 rounded-2xl"
        inner="flex min-w-0 items-center gap-3"
      >
        <PersonAvatar user={person} size={52} online={isOnline} />
        <span className="min-w-0 flex-1 py-0.5 text-left">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[15px] font-bold tracking-[-0.01em]">{person.displayName}</span>
            {person.isVerified ? <VerifiedTick size="sm" className="h-[15px] w-[15px] shrink-0" /> : null}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-frenz-muted">
            @{person.handle} · {formatCompactNumber(person.followersCount)} followers
          </span>
        </span>
      </PendingLink>
      <FollowChip id={person.id} name={person.displayName} initial={person.isFollowing ?? false} />
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   States
   ──────────────────────────────────────────────────────────────────────── */

/** The same geometry as a real row, so nothing moves when people arrive. */
function SkeletonRows() {
  return (
    <ul role="status" aria-live="polite" className={LIST}>
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

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center rounded-[24px] border border-frenz-line bg-frenz-card px-6 py-14 text-center">
      <span aria-hidden className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-frenz-violet/10 text-frenz-violet">
        <Users className="h-6 w-6" />
      </span>
      <p className="text-[15.5px] font-semibold">No users found</p>
      <p className="mt-1.5 max-w-xs text-[13.5px] text-frenz-muted">Nothing matched “{query.trim()}”. Try another name or @handle.</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-[24px] border border-frenz-line bg-frenz-card px-6 py-14 text-center">
      <p className="text-[15.5px] font-semibold">Couldn&rsquo;t search right now</p>
      <p className="mt-1.5 max-w-xs text-[13.5px] text-frenz-muted">Check your connection. Everything else on this page still works.</p>
      <button type="button" onClick={onRetry} className={cn(primaryPill, "mt-5")}>
        <RotateCw className="h-4 w-4" aria-hidden /> Try again
      </button>
    </div>
  );
}

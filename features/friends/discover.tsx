"use client";

import { BadgeCheck, Search, UserCheck, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { toggleFollow, useFollowState } from "@/lib/social/follow-store";
import type { SearchPerson } from "@/lib/social/search";
import type { SuggestedCreator } from "@/lib/social/suggest";
import { cn, formatCompactNumber } from "@/lib/utils";

type Person = { id: string; handle: string; displayName: string; avatarUrl: string | null; isVerified: boolean; followersCount: number };

/**
 * Full-page "Add friends" — opens instantly (suggestions are server-rendered) and
 * lets you search anyone's profile by name/@handle. Follow buttons use the shared
 * follow store, so a follow here reflects everywhere and never re-offers "Follow".
 */
export function FriendsDiscover({ initialSuggestions }: { initialSuggestions: SuggestedCreator[] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchPerson[] | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults(null);
      setLoading(false);
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    setLoading(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?type=people&q=${encodeURIComponent(term)}`);
        const j = (await res.json()) as { people?: SearchPerson[] };
        setResults(j.people ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const searching = results !== null;

  return (
    <div>
      {/* Search */}
      <div className="sticky top-16 z-10 -mx-3 mb-4 bg-background/80 px-3 py-2 backdrop-blur-xl sm:-mx-4 sm:px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people by name or @handle"
            aria-label="Search people"
            autoComplete="off"
            className="h-12 w-full rounded-2xl bg-secondary/60 pl-10 pr-10 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-transparent transition focus:bg-background focus:ring-primary"
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Clear" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <h2 className="mb-2 px-1 text-sm font-bold text-muted-foreground">
        {searching ? (loading ? "Searching…" : `Results${results && results.length ? ` · ${results.length}` : ""}`) : "People you may know"}
      </h2>

      {searching ? (
        results && results.length > 0 ? (
          <ul className="space-y-1">{results.map((p) => <PersonRow key={p.id} person={p} />)}</ul>
        ) : loading ? (
          <SkeletonRows />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">No one matches “{q}”.</p>
        )
      ) : initialSuggestions.length > 0 ? (
        <ul className="space-y-1">{initialSuggestions.map((p) => <PersonRow key={p.id} person={p} />)}</ul>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">No suggestions yet — try searching for someone.</p>
      )}
    </div>
  );
}

function PersonRow({ person }: { person: Person }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl px-2 py-2 transition hover:bg-secondary/50">
      <Link href={`/u/${person.handle}`} className="shrink-0">
        {person.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={person.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-border/50" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-base font-bold text-white">
            {person.displayName.charAt(0).toUpperCase()}
          </span>
        )}
      </Link>
      <Link href={`/u/${person.handle}`} className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-semibold">
          <span className="truncate">{person.displayName}</span>
          {person.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">@{person.handle} · {formatCompactNumber(person.followersCount)} followers</span>
      </Link>
      <FollowChip id={person.id} />
    </li>
  );
}

function FollowChip({ id }: { id: string }) {
  const following = useFollowState(id, false);
  return (
    <button
      type="button"
      onClick={() => toggleFollow(id, !following)}
      aria-pressed={following}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-4 py-2 text-xs font-bold transition active:scale-95",
        following ? "bg-secondary text-foreground" : "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-sm shadow-violet-500/30",
      )}
    >
      {following ? <><UserCheck className="h-3.5 w-3.5" /> Following</> : <><UserPlus className="h-3.5 w-3.5" /> Follow</>}
    </button>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-1" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-2">
          <span className="h-12 w-12 shrink-0 rounded-full bg-secondary shimmer" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-32 rounded bg-secondary shimmer" />
            <span className="block h-2.5 w-24 rounded bg-secondary shimmer" />
          </span>
          <span className="h-8 w-20 rounded-full bg-secondary shimmer" />
        </li>
      ))}
    </ul>
  );
}

"use client";

import { BadgeCheck, Check, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useRef, useState } from "react";

import { PostGrid } from "@/components/social/post-grid";
import type { SearchPerson, SearchResult, SearchType } from "@/lib/social/search";
import { cn, formatCompactNumber } from "@/lib/utils";

const TABS: { id: SearchType; label: string }[] = [
  { id: "all", label: "Top" },
  { id: "people", label: "People" },
  { id: "video", label: "Reels" },
  { id: "image", label: "Photos" },
  { id: "audio", label: "Audio" },
];

/**
 * Universal search results with instant, cached type tabs (Top / People / Reels /
 * Photos / Audio). Switching a tab re-uses a cached result when possible; the
 * current results stay on screen while a new query loads (no skeleton flash).
 */
export function SearchResults({ initialQuery, initial }: { initialQuery: string; initial: SearchResult }) {
  const router = useRouter();
  const cache = useRef<Map<string, SearchResult>>(new Map([[`${initialQuery}:all`, initial]]));
  const reqId = useRef(0);
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<SearchType>("all");
  const [result, setResult] = useState<SearchResult>(initial);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (q: string, t: SearchType) => {
    const term = q.trim();
    if (!term) {
      setResult({ people: [], posts: [] });
      return;
    }
    const key = `${term}:${t}`;
    const cached = cache.current.get(key);
    if (cached) {
      setResult(cached);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}&type=${t}`);
      const data = (await res.json()) as SearchResult;
      if (id !== reqId.current) return;
      cache.current.set(key, data);
      setResult(data);
    } catch {
      /* keep current */
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = input.trim();
    setQuery(term);
    if (typeof window !== "undefined") window.history.replaceState(window.history.state, "", term ? `/search?q=${encodeURIComponent(term)}` : "/search");
    void run(term, type);
  };

  const pick = (t: SearchType) => {
    setType(t);
    void run(query, t);
  };

  const gridLayout = type === "image" ? "photo" : type === "video" ? "reel" : "card";
  const showPeople = (type === "all" || type === "people") && result.people.length > 0;
  const showPosts = type !== "people";

  return (
    <div>
      <form onSubmit={submit} className="relative mb-5">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          placeholder="Search reels, posts, audio, #hashtags, people…"
          aria-label="Search"
          className="h-12 w-full rounded-full bg-secondary/50 pl-12 pr-4 text-sm outline-none ring-1 ring-inset ring-transparent transition focus:bg-background focus:ring-2 focus:ring-primary/40"
        />
      </form>

      {/* Type tabs */}
      <div className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            aria-pressed={type === t.id}
            className={cn(
              "shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition",
              type === t.id ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Thin loading bar */}
      <div className={cn("mb-4 h-0.5 overflow-hidden rounded-full transition-opacity", loading ? "opacity-100" : "opacity-0")}>
        <span className="block h-full w-1/3 animate-[srch_1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
      </div>

      {!query ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Search for reels, posts, audio, hashtags and people.</p>
      ) : !showPeople && (!showPosts || result.posts.length === 0) ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No results for &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
          {showPeople ? (
            <section>
              {type === "all" ? <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">People</h2> : null}
              <ul className="space-y-1.5">
                {result.people.map((p) => (
                  <PersonRow key={p.id} person={p} />
                ))}
              </ul>
            </section>
          ) : null}

          {showPosts && result.posts.length > 0 ? (
            <section>
              {type === "all" ? <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">Posts</h2> : null}
              <PostGrid posts={result.posts} layout={gridLayout} emptyText="" />
            </section>
          ) : null}
        </div>
      )}

      <style>{`@keyframes srch{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
    </div>
  );
}

function PersonRow({ person: p }: { person: SearchPerson }) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const doFollow = async () => {
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/follow/${p.id}`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex items-center gap-3 rounded-2xl px-2 py-1.5 transition hover:bg-secondary/50">
      <Link href={`/u/${p.handle}`} className="shrink-0">
        {p.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover ring-2 ring-border/50" />
        ) : (
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-base font-bold text-white">{p.displayName.charAt(0).toUpperCase()}</span>
        )}
      </Link>
      <Link href={`/u/${p.handle}`} className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-semibold">
          <span className="truncate">{p.displayName}</span>
          {p.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">@{p.handle} · {formatCompactNumber(p.followersCount)} followers</span>
      </Link>
      <button
        type="button"
        onClick={doFollow}
        disabled={busy}
        className={cn(
          "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition active:scale-95",
          following ? "bg-secondary text-foreground" : "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-sm shadow-violet-500/30",
        )}
      >
        {following ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Following</span> : "Follow"}
      </button>
    </li>
  );
}

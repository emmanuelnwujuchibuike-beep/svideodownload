"use client";

import { Music } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Skeleton } from "@/features/ui/skeleton";
import { SOUND_GENRES, SOUND_MOODS, type Sound, type SoundGenre, type SoundMood } from "@/lib/social/sounds";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * The /sounds page's actual data — split from the page shell so the shell
 * (header, filter chips) paints instantly and this fetches after, behind the
 * global skeleton (owner: "the rest sounds that needs api calls can load
 * after the page have opens, using the global skeleton and lazy loading").
 * Filters are client-side state, not a page navigation — switching a mood
 * chip re-fetches in place rather than reloading the route.
 */
export function SoundDiscoveryClient() {
  const [mood, setMood] = useState<SoundMood | null>(null);
  const [genre, setGenre] = useState<SoundGenre | null>(null);
  const [data, setData] = useState<{ trending: Sound[]; fresh: Sound[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (mood) params.set("mood", mood);
    if (genre) params.set("genre", genre);
    fetch(`/api/sounds/discovery?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (id !== reqId.current || !json) return;
        setData(json);
      })
      .catch(() => {})
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [mood, genre]);

  const filtered = !!(mood || genre);
  const pick = (kind: "mood" | "genre", value: string) => {
    if (kind === "mood") setMood((m) => (m === value ? null : (value as SoundMood)));
    else setGenre((g) => (g === value ? null : (value as SoundGenre)));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={!filtered} onClick={() => { setMood(null); setGenre(null); }}>
          All
        </FilterChip>
        {SOUND_MOODS.map((m) => (
          <FilterChip key={m} active={mood === m} onClick={() => pick("mood", m)}>
            {m}
          </FilterChip>
        ))}
        {SOUND_GENRES.map((g) => (
          <FilterChip key={g} active={genre === g} onClick={() => pick("genre", g)}>
            {g}
          </FilterChip>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-[-0.02em]">{filtered ? "Matching sounds" : "Trending"}</h2>
        {loading && !data ? (
          <SoundListSkeleton />
        ) : data && data.trending.length > 0 ? (
          <SoundList sounds={data.trending} />
        ) : (
          <p className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
            No sounds here yet.
          </p>
        )}
      </section>

      {!filtered && data && data.fresh.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold tracking-[-0.02em]">New</h2>
          <SoundList sounds={data.fresh} />
        </section>
      ) : null}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition",
        active ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SoundList({ sounds }: { sounds: Sound[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {sounds.map((s) => (
        <Link
          key={s.id}
          href={`/sound/${s.id}`}
          className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-soft transition hover:bg-secondary/40"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-blue-600 to-violet-700">
            {s.coverArtUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.coverArtUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Music className="h-5 w-5 text-white/80" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{s.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{s.artistLabel}</span>
          </span>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">{formatCompactNumber(s.usageCount)} reels</span>
        </Link>
      ))}
    </div>
  );
}

function SoundListSkeleton() {
  return (
    <div className="grid gap-2 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

import { Music } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import {
  listNewSounds,
  listTrendingSounds,
  SOUND_GENRES,
  SOUND_MOODS,
  type Sound,
  type SoundGenre,
  type SoundMood,
} from "@/lib/social/sounds";
import { cn, formatCompactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sounds — FrenzSave",
  description: "Discover trending and new sounds, and use them in your own Reel.",
};

function isMood(v: string | undefined): v is SoundMood {
  return !!v && (SOUND_MOODS as readonly string[]).includes(v);
}
function isGenre(v: string | undefined): v is SoundGenre {
  return !!v && (SOUND_GENRES as readonly string[]).includes(v);
}

export default async function SoundsPage({
  searchParams,
}: {
  searchParams: Promise<{ mood?: string; genre?: string }>;
}) {
  const sp = await searchParams;
  const mood = isMood(sp.mood) ? sp.mood : null;
  const genre = isGenre(sp.genre) ? sp.genre : null;
  const filtered = !!(mood || genre);

  const [trending, fresh] = await Promise.all([
    listTrendingSounds({ mood, genre, limit: filtered ? 60 : 20 }),
    filtered ? Promise.resolve([]) : listNewSounds(20),
  ]);

  return (
    <>
      <SiteHeader social />
      <main className="container max-w-4xl pb-24 pt-[calc(var(--frenz-safe-top)+1.25rem)] lg:pt-24">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Sounds</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Trending and new sounds — tap one to use it in your own Reel.</p>

        {/* Mood/genre filter chips — a creator-set tag on each sound, never an
            AI-inferred mood (see docs/FEATURE_15_PART_7_MUSIC.md). */}
        <div className="mt-5 flex flex-wrap gap-1.5">
          <FilterChip href="/sounds" active={!filtered}>
            All
          </FilterChip>
          {SOUND_MOODS.map((m) => (
            <FilterChip key={m} href={`/sounds?mood=${m}`} active={mood === m}>
              {m}
            </FilterChip>
          ))}
          {SOUND_GENRES.map((g) => (
            <FilterChip key={g} href={`/sounds?genre=${g}`} active={genre === g}>
              {g}
            </FilterChip>
          ))}
        </div>

        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold tracking-[-0.02em]">{filtered ? "Matching sounds" : "Trending"}</h2>
          {trending.length > 0 ? (
            <SoundList sounds={trending} />
          ) : (
            <p className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
              No sounds here yet.
            </p>
          )}
        </section>

        {!filtered && fresh.length > 0 ? (
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold tracking-[-0.02em]">New</h2>
            <SoundList sounds={fresh} />
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition",
        active ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
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

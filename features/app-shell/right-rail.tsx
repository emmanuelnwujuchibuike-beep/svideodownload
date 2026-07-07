import { Hash, Rocket } from "lucide-react";
import Link from "next/link";

import { SuggestList } from "@/features/app-shell/suggest-list";
import type { HomeProfile } from "@/lib/social/home";
import type { SuggestedCreator } from "@/lib/social/suggest";
import { formatCompactNumber } from "@/lib/utils";

// Representative trending tags — a hashtag system isn't modelled yet, so these
// are illustrative until tags ship.
const HASHTAGS = [
  { tag: "FunnyVideos", views: 23_100_000, color: "from-rose-500 to-pink-600" },
  { tag: "TravelDiaries", views: 18_600_000, color: "from-sky-500 to-blue-600" },
  { tag: "FootballGoals", views: 15_200_000, color: "from-emerald-500 to-teal-600" },
  { tag: "MusicVibes", views: 12_400_000, color: "from-violet-500 to-purple-600" },
  { tag: "FoodLovers", views: 9_800_000, color: "from-amber-500 to-orange-600" },
];

export function RightRail({
  profile,
  suggestions,
}: {
  profile: HomeProfile | null;
  suggestions: SuggestedCreator[];
}) {
  const firstName = profile?.displayName?.split(" ")[0] ?? "there";

  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-80 shrink-0 flex-col gap-4 overflow-y-auto py-4 pr-4 xl:flex">
      {/* Profile card */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 text-center shadow-soft">
        {profile?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatarUrl} alt="" className="mx-auto h-16 w-16 rounded-full object-cover ring-2 ring-violet-500/30" />
        ) : (
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-2xl font-bold text-white">
            {firstName.charAt(0).toUpperCase()}
          </span>
        )}
        <p className="mt-3 text-base font-bold">Hi, {firstName}</p>
        <p className="text-xs text-muted-foreground">Welcome back!</p>

        <dl className="mt-4 grid grid-cols-3 gap-1 border-y border-border/50 py-3">
          <Stat label="Following" value={profile?.followingCount ?? 0} />
          <Stat label="Followers" value={profile?.followersCount ?? 0} />
          <Stat label="Likes" value={profile?.likesCount ?? 0} />
        </dl>

        <Link
          href={profile?.handle ? `/u/${profile.handle}` : "/account#profile"}
          className="mt-4 block rounded-xl bg-secondary py-2 text-sm font-semibold transition hover:bg-secondary/70"
        >
          {profile?.handle ? "View Profile" : "Set up Profile"}
        </Link>
      </section>

      {/* People you may know */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold">People You May Know</h3>
          <Link href="/explore" className="text-xs font-medium text-primary hover:underline">See all</Link>
        </div>
        <SuggestList
          items={suggestions.map((s) => ({
            id: s.id,
            handle: s.handle,
            displayName: s.displayName,
            avatarUrl: s.avatarUrl,
            isVerified: s.isVerified,
            followersCount: s.followersCount,
          }))}
        />
      </section>

      {/* Trending hashtags */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold">Trending Hashtags</h3>
          <Link href="/explore?sort=trending" className="text-xs font-medium text-primary hover:underline">See all</Link>
        </div>
        <ul className="space-y-3">
          {HASHTAGS.map((h) => (
            <li key={h.tag}>
              <Link href="/explore?sort=trending" className="flex items-center gap-3">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${h.color} text-white`}>
                  <Hash className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{h.tag}</span>
                  <span className="block text-[11px] text-muted-foreground">{formatCompactNumber(h.views)} views</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Go premium */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-violet-600 to-purple-700 p-5 text-white shadow-elevated">
        <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/15 blur-2xl" />
        <Rocket className="h-7 w-7" />
        <p className="mt-3 text-base font-bold">Go Premium</p>
        <p className="mt-1 text-xs text-white/80">Unlock all features and enjoy an ad-free experience.</p>
        <Link href="/pricing" className="mt-4 inline-block rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-900 shadow transition hover:bg-white/90">
          Upgrade Now
        </Link>
      </section>

      {/* Active friends */}
      {suggestions.length > 0 ? (
        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold">Active Friends</h3>
            <Link href="/messages" className="text-xs font-medium text-primary hover:underline">See all</Link>
          </div>
          <ul className="space-y-3">
            {suggestions.slice(0, 5).map((s) => (
              <li key={s.id}>
                <Link href={`/u/${s.handle}`} className="flex items-center gap-2.5">
                  <span className="relative shrink-0">
                    {s.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-border" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">
                        {s.displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-card" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{s.displayName}</span>
                    <span className="block text-[11px] text-emerald-500">Online</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="text-sm font-bold tabular-nums">{formatCompactNumber(value)}</dd>
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
    </div>
  );
}

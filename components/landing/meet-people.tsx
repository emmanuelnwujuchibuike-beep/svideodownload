import { BadgeCheck, MessageCircle, UserPlus } from "lucide-react";
import Link from "next/link";

import { getSuggestedCreators } from "@/lib/social/suggest";
import { formatCompactNumber } from "@/lib/utils";

// Sample profiles used to keep the rail balanced (always 4 + CTA) when there
// aren't yet 4 real public creators to feature.
const SAMPLE_PEOPLE = [
  { name: "Sarah", sub: "Lagos, Nigeria · Photography", emoji: "👩🏽", from: "from-rose-500 to-pink-600", action: "add" },
  { name: "James", sub: "London, UK · Watching Trending", emoji: "🧑🏻", from: "from-blue-500 to-indigo-600", action: "chat" },
  { name: "Maria", sub: "Brazil · Music Lover", emoji: "👩🏼", from: "from-violet-500 to-purple-600", action: "follow" },
  { name: "Daniel", sub: "New York, USA · Football Fan", emoji: "🧑🏾", from: "from-emerald-500 to-teal-600", action: "add" },
] as const;

const CLUSTER = [
  { from: "from-rose-500 to-pink-600", emoji: "👩🏽" },
  { from: "from-blue-500 to-indigo-600", emoji: "🧑🏻" },
  { from: "from-violet-500 to-purple-600", emoji: "👨🏾" },
  { from: "from-amber-500 to-orange-600", emoji: "👩🏼" },
];

const ACTION = {
  add: { label: "Add Friend", Icon: UserPlus, light: true },
  chat: { label: "Chat", Icon: MessageCircle, light: false },
  follow: { label: "Follow", Icon: UserPlus, light: true },
} as const;

/** Landing "Meet New People" rail — real public creators padded to 4 + a join CTA. */
export async function MeetNewPeople() {
  const creators = await getSuggestedCreators(null, 4);

  // Always render exactly 4 cards: real creators first, padded with samples.
  const cards = [
    ...creators.map((c, i) => {
      const style = SAMPLE_PEOPLE[i % 4] ?? SAMPLE_PEOPLE[0];
      return {
        key: c.handle,
        href: `/u/${c.handle}`,
        name: c.displayName,
        sub: `${formatCompactNumber(c.followersCount)} followers`,
        verified: c.isVerified,
        avatarUrl: c.avatarUrl,
        emoji: style.emoji,
        from: style.from,
        action: style.action as keyof typeof ACTION,
      };
    }),
    ...SAMPLE_PEOPLE.slice(creators.length).map((s) => ({
      key: s.name,
      href: "/login?signup=1",
      name: s.name,
      sub: s.sub,
      verified: false,
      avatarUrl: null as string | null,
      emoji: s.emoji,
      from: s.from,
      action: s.action as keyof typeof ACTION,
    })),
  ].slice(0, 4);

  return (
    <section className="container max-w-6xl py-10 sm:py-14">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">Meet New People</h2>
          <p className="mt-1 text-sm text-muted-foreground">Connect with amazing people around the world.</p>
        </div>
        <Link href="/explore" className="text-sm font-semibold text-primary hover:underline">
          View All
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => {
          const act = ACTION[c.action];
          return (
            <Link
              key={c.key}
              href={c.href}
              className="group relative aspect-[3/4] overflow-hidden rounded-2xl shadow-soft ring-1 ring-border/60 transition hover:-translate-y-1 hover:shadow-card"
            >
              {c.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105" />
              ) : (
                <span className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${c.from} text-6xl`}>
                  {c.emoji}
                </span>
              )}
              <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
              <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online
              </span>
              <span className="absolute inset-x-2.5 bottom-2.5 text-white">
                <span className="flex items-center gap-1 text-sm font-bold">
                  <span className="truncate">{c.name}</span>
                  {c.verified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0" /> : null}
                </span>
                <span className="block truncate text-[11px] text-white/70">{c.sub}</span>
                <span
                  className={`mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition ${
                    act.light
                      ? "bg-white/95 text-slate-900 group-hover:bg-white"
                      : "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                  }`}
                >
                  <act.Icon className="h-3.5 w-3.5" /> {act.label}
                </span>
              </span>
            </Link>
          );
        })}

        {/* Join CTA card */}
        <div className="flex flex-col justify-center rounded-2xl bg-gradient-to-br from-blue-500/10 via-violet-500/10 to-fuchsia-500/10 p-5 ring-1 ring-violet-500/15">
          <h3 className="text-lg font-bold leading-tight tracking-tight">
            Find friends.<br />Build connections.<br />Create memories.
          </h3>
          <div className="mt-3 flex -space-x-2">
            {CLUSTER.map((g, i) => (
              <span key={i} className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${g.from} text-sm ring-2 ring-background`}>
                {g.emoji}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Join millions of people already on Frenz.</p>
          <Link
            href="/login?signup=1"
            className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
          >
            Join Community
          </Link>
        </div>
      </div>
    </section>
  );
}

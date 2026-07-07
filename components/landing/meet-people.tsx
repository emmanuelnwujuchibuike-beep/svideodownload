import { BadgeCheck, MessageCircle, UserPlus, UserRound } from "lucide-react";
import Link from "next/link";

import { getSuggestedCreators } from "@/lib/social/suggest";
import { createClient } from "@/lib/supabase/server";
import { formatCompactNumber } from "@/lib/utils";

// Display profiles used when signed-out (and to pad the rail to a tidy 4).
const SAMPLE_PEOPLE = [
  { name: "Sarah", sub: "Lagos, Nigeria · Photography", from: "from-rose-500 to-pink-600", action: "add" },
  { name: "James", sub: "London, UK · Watching Trending", from: "from-blue-500 to-indigo-600", action: "chat" },
  { name: "Maria", sub: "Brazil · Music Lover", from: "from-violet-500 to-purple-600", action: "follow" },
  { name: "Daniel", sub: "New York, USA · Football Fan", from: "from-emerald-500 to-teal-600", action: "add" },
] as const;

const CLUSTER = [
  { from: "from-rose-500 to-pink-600" },
  { from: "from-blue-500 to-indigo-600" },
  { from: "from-violet-500 to-purple-600" },
  { from: "from-amber-500 to-orange-600" },
];

const ACTION = {
  add: { label: "Add Friend", Icon: UserPlus, light: true },
  chat: { label: "Chat", Icon: MessageCircle, light: false },
  follow: { label: "Follow", Icon: UserPlus, light: true },
} as const;

type Card = {
  key: string;
  href: string;
  name: string;
  sub: string;
  verified: boolean;
  avatarUrl: string | null;
  from: string;
  action: keyof typeof ACTION;
};

/** Landing "Meet New People" — real public creators when signed in; tasteful
 * display profiles (Add → create account) when signed out. */
export async function MeetNewPeople() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = !!user;

  // Signed-out → display profiles whose CTA leads straight to create-account.
  const SIGNUP = "/login?signup=1";
  let cards: Card[];

  if (signedIn) {
    const creators = await getSuggestedCreators(user.id, 4);
    const real: Card[] = creators.map((c, i) => {
      const style = SAMPLE_PEOPLE[i % 4] ?? SAMPLE_PEOPLE[0];
      return {
        key: c.handle,
        href: `/u/${c.handle}`,
        name: c.displayName,
        sub: `${formatCompactNumber(c.followersCount)} followers`,
        verified: c.isVerified,
        avatarUrl: c.avatarUrl,
        from: style.from,
        action: style.action as keyof typeof ACTION,
      };
    });
    // Pad with sample profiles (linking to Explore) so the rail stays a tidy 4.
    const pad: Card[] = SAMPLE_PEOPLE.slice(creators.length).map((s) => ({
      key: s.name,
      href: "/explore",
      name: s.name,
      sub: s.sub,
      verified: false,
      avatarUrl: null,
      from: s.from,
      action: s.action as keyof typeof ACTION,
    }));
    cards = [...real, ...pad].slice(0, 4);
  } else {
    cards = SAMPLE_PEOPLE.map((s) => ({
      key: s.name,
      href: SIGNUP,
      name: s.name,
      sub: s.sub,
      verified: false,
      avatarUrl: null,
      from: s.from,
      action: s.action as keyof typeof ACTION,
    }));
  }

  return (
    <section className="container max-w-6xl py-10 sm:py-14">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">Meet New People</h2>
          <p className="mt-1 text-sm text-muted-foreground">Connect with amazing people around the world.</p>
        </div>
        <Link href={signedIn ? "/explore" : SIGNUP} className="text-sm font-semibold text-primary hover:underline">
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
                <img src={c.avatarUrl} alt={c.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105" />
              ) : (
                <span className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${c.from} text-4xl font-bold text-white`}>
                  {c.name.charAt(0).toUpperCase()}
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
              <span key={i} aria-hidden className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${g.from} ring-2 ring-background`}>
                <UserRound className="h-4 w-4 text-white" />
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Join millions of people already on Frenz.</p>
          <Link
            href={signedIn ? "/explore" : SIGNUP}
            className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
          >
            {signedIn ? "Discover more" : "Join Community"}
          </Link>
        </div>
      </div>
    </section>
  );
}

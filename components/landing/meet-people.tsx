import { MessageCircle, UserPlus } from "lucide-react";
import Link from "next/link";

import { BitmojiAvatar } from "@/components/landing/bitmoji-avatar";

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
  from: string;
  action: keyof typeof ACTION;
};

// Signed-out → display profiles whose CTA leads straight to create-account.
const SIGNUP = "/login?signup=1";

/**
 * Landing "Meet New People" — display profiles whose CTA leads to create-account.
 *
 * This used to branch on `getUser()` and show real suggested creators to signed-in
 * visitors. That branch is now unreachable: middleware redirects signed-in visitors
 * from `/` to `/home`, so everyone who sees this page is signed out and always got
 * the display profiles anyway. Removing the branch is therefore behaviour-neutral —
 * and it drops the last `cookies()` read from the `/` tree, which is what allows the
 * landing page to be statically generated at all (docs/FEATURE_21_LANDING.md §4).
 *
 * Do NOT reintroduce a server-side auth read here: a single `createClient()`
 * anywhere in this tree silently un-statics the whole landing page.
 */
export function MeetNewPeople() {
  const cards: Card[] = SAMPLE_PEOPLE.map((s) => ({
    key: s.name,
    href: SIGNUP,
    name: s.name,
    sub: s.sub,
    from: s.from,
    action: s.action as keyof typeof ACTION,
  }));

  return (
    <section className="container max-w-6xl py-10 sm:py-14">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">Meet New People</h2>
          <p className="mt-1 text-sm text-muted-foreground">Connect with amazing people around the world.</p>
        </div>
        <Link href={SIGNUP} className="text-sm font-semibold text-primary hover:underline">
          View All
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c, i) => {
          const act = ACTION[c.action];
          return (
            <Link
              key={c.key}
              href={c.href}
              style={{ animationDelay: `${i * 70}ms` }}
              className="group relative aspect-[3/4] animate-fade-up overflow-hidden rounded-2xl shadow-soft ring-1 ring-border/60 transition-all duration-300 [transition-timing-function:var(--ease-spring)] will-change-transform hover:-translate-y-1.5 hover:shadow-elevated hover:ring-violet-500/30"
            >
              {/* 3D-shaded cartoon avatar, never a real face or the old "S"/"D"
                  initial. Fills the card Snapchat-friend-card style; scales gently
                  on hover so the row feels alive. */}
              <span className={`absolute inset-0 bg-gradient-to-br ${c.from}`} />
              <span className="absolute inset-x-0 top-0 flex h-[72%] items-end justify-center">
                <BitmojiAvatar
                  seed={c.name}
                  className="h-[118%] w-[82%] translate-y-[6%] drop-shadow-[0_6px_10px_rgba(0,0,0,0.28)] transition-transform duration-500 [transition-timing-function:var(--ease-out)] group-hover:scale-105"
                />
              </span>
              {/* Sheen sweep on hover */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:translate-x-full"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
              <span className="absolute inset-x-2.5 bottom-2.5 text-white">
                <span className="flex items-center gap-1 text-sm font-bold">
                  <span className="truncate">{c.name}</span>
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
              <span key={i} aria-hidden className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${g.from} ring-2 ring-background`}>
                <BitmojiAvatar seed={`cluster-${i}`} className="h-full w-full" />
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Join millions of people already on Frenz.</p>
          <Link
            href={SIGNUP}
            className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
          >
            Join Community
          </Link>
        </div>
      </div>
    </section>
  );
}

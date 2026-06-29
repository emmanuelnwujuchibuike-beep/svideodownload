import { BadgeCheck, UserPlus } from "lucide-react";
import Link from "next/link";

import { getSuggestedCreators } from "@/lib/social/suggest";
import { formatCompactNumber } from "@/lib/utils";

const FALLBACK_GRADIENTS = [
  "from-rose-500 to-pink-600",
  "from-blue-500 to-indigo-600",
  "from-violet-500 to-purple-600",
  "from-emerald-500 to-teal-600",
];

const CLUSTER = ["from-rose-500 to-pink-600", "from-blue-500 to-indigo-600", "from-violet-500 to-purple-600", "from-amber-500 to-orange-600"];

/** Landing "Meet New People" rail — real public creators + a join CTA card. */
export async function MeetNewPeople() {
  const creators = await getSuggestedCreators(null, 4);

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
        {creators.map((c, i) => (
          <Link
            key={c.handle}
            href={`/u/${c.handle}`}
            className="group relative aspect-[3/4] overflow-hidden rounded-2xl shadow-soft ring-1 ring-border/60 transition hover:-translate-y-1 hover:shadow-card"
          >
            {c.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105" />
            ) : (
              <span className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${FALLBACK_GRADIENTS[i % 4]} text-4xl font-bold text-white`}>
                {c.displayName.charAt(0).toUpperCase()}
              </span>
            )}
            {/* Dark gradient overlay */}
            <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
            {/* Online */}
            <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online
            </span>
            {/* Info + action */}
            <span className="absolute inset-x-2.5 bottom-2.5 text-white">
              <span className="flex items-center gap-1 text-sm font-bold">
                <span className="truncate">{c.displayName}</span>
                {c.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0" /> : null}
              </span>
              <span className="block text-[11px] text-white/70">{formatCompactNumber(c.followersCount)} followers</span>
              <span className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/95 py-2 text-xs font-semibold text-slate-900 transition group-hover:bg-white">
                <UserPlus className="h-3.5 w-3.5" /> Add Friend
              </span>
            </span>
          </Link>
        ))}

        {/* Join CTA card */}
        <div className="flex flex-col justify-center rounded-2xl bg-gradient-to-br from-blue-500/10 via-violet-500/10 to-fuchsia-500/10 p-5 ring-1 ring-violet-500/15">
          <h3 className="text-lg font-bold leading-tight tracking-tight">
            Find friends.<br />Build connections.<br />Create memories.
          </h3>
          <div className="mt-3 flex -space-x-2">
            {CLUSTER.map((g, i) => (
              <span key={i} className={`h-8 w-8 rounded-full bg-gradient-to-br ${g} ring-2 ring-background`} />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Join millions of people already on FrenzSave.</p>
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

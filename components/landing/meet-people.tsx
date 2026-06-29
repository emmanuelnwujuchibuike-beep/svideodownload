import { ArrowRight, BadgeCheck, UserPlus } from "lucide-react";
import Link from "next/link";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { getSuggestedCreators } from "@/lib/social/suggest";
import { formatCompactNumber } from "@/lib/utils";

/** Landing "Meet New People" rail — real public creators + a join CTA. */
export async function MeetNewPeople() {
  const creators = await getSuggestedCreators(null, 7);

  return (
    <section className="container max-w-6xl py-12 sm:py-16">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">Meet new people</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">Connect with creators around the world.</p>
        </div>
        <Link href="/explore" className="hidden text-sm font-medium text-primary hover:underline sm:inline">
          View all
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {creators.map((c) => (
          <Link
            key={c.handle}
            href={`/u/${c.handle}`}
            className="group flex flex-col items-center rounded-2xl border border-border/70 bg-card p-4 text-center shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
          >
            <span className="relative">
              {c.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-border" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-xl font-bold text-white">
                  {c.displayName.charAt(0).toUpperCase()}
                </span>
              )}
              <DiamondCrownBadge plan={c.plan} size="xs" className="absolute -bottom-1 -right-1 ring-2 ring-card" />
            </span>
            <span className="mt-3 flex items-center gap-1 text-sm font-semibold">
              <span className="max-w-[8rem] truncate">{c.displayName}</span>
              {c.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
            </span>
            <span className="text-xs text-muted-foreground">{formatCompactNumber(c.followersCount)} followers</span>
            <span className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-secondary py-2 text-xs font-semibold transition group-hover:bg-primary group-hover:text-primary-foreground">
              <UserPlus className="h-3.5 w-3.5" /> Follow
            </span>
          </Link>
        ))}

        {/* Join CTA card */}
        <div className="flex flex-col justify-center rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-violet-500/[0.05] to-transparent p-5">
          <h3 className="text-lg font-bold leading-tight tracking-tight">
            Find friends.
            <br /> Build connections.
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground">Join the FrenzSave community.</p>
          <Link
            href="/login?signup=1"
            className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
          >
            Join community <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

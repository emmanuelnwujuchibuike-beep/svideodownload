import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { CalendarIcon } from "@/features/frenz-ui/icons";
import { VerifiedBadge } from "@/features/frenz-ui/primitives";
import { LivingGlow } from "@/features/profile/living-glow";
import { cn, formatCompactNumber } from "@/lib/utils";

/*
  The profile hero (design/Profile.dc.html, updated 2026-10-18), shared by the owner's and a
  visitor's view so the two can never drift: the cover running under the status bar, the
  avatar overlapping it on the left, the name in Sora with the seal, the handle and the
  profile type, bio, joined date, a white stats card and the action row — on the white page,
  no glass card around it. Every piece of data and every action is the page's own; this file
  only arranges them.
*/

/** The cover: the member's banner (or the Living Profile light), a soft scrim at its foot for the avatar. */
export function ProfileCover({ bannerUrl, joinedAt, children }: { bannerUrl: string | null; joinedAt: string; children?: ReactNode }) {
  return (
    // no cover picture: the plain app white (owner, 2026-10-31: "should show [no] purple or blue background, rather a plain
    // app white") — no theme wash, no glow, no dark scrim; the scrim only exists to seat the avatar on a photo
    <div className={cn("relative h-[calc(210px+var(--frenz-safe-top))] w-full overflow-hidden sm:h-60 sm:rounded-3xl", bannerUrl ? "frenz-profile-wash" : "bg-frenz-page")}>
      {bannerUrl ? (
        <>
          <Image src={bannerUrl} alt="" fill priority sizes="(max-width: 1024px) 100vw, 900px" className="object-cover" />
          <LivingGlow joinedAt={joinedAt} />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[90px] bg-gradient-to-t from-black/55 to-transparent" />
        </>
      ) : null}
      {children}
    </div>
  );
}

/** Avatar on the left over the cover's edge, something (the streak) on the right, then who this is. */
export function ProfileIdentity({
  avatar,
  aside,
  name,
  verified,
  badges,
  handle,
  typeLabel,
  extras,
  bio,
  website,
  joined,
}: {
  avatar: ReactNode;
  aside?: ReactNode;
  name: string;
  verified: boolean;
  /** The plan badge etc. — beside the name, after the seal. */
  badges?: ReactNode;
  handle: string;
  /** "BUSINESS", "CREATOR"… — only for a declared profile type. */
  typeLabel?: string | null;
  /** Headline, mood / status, reputation — under the handle when there is any. */
  extras?: ReactNode;
  bio?: string | null;
  website?: string | null;
  joined: string;
}) {
  /*
    A long name never runs off the screen (owner, 2026-10-29, with a screenshot of "richmondodurokwarteng99" cut at the
    edge): the size steps down with the length so most names still sit on one line, and `overflow-wrap: anywhere`
    breaks a single unbroken word as the last resort. `min-w-0` lets the heading shrink inside the flex row.
  */
  const nameSize = name.length <= 14 ? "text-[30px] tracking-[-1px]" : name.length <= 20 ? "text-[25px] tracking-[-0.75px]" : "text-[21px] tracking-[-0.5px]";
  return (
    <section className="frenz-ui relative flex flex-col gap-3.5 px-5">
      <div className="-mt-[52px] flex items-end justify-between">
        {avatar}
        {aside ? <div className="pb-1">{aside}</div> : null}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={cn("m-0 min-w-0 max-w-full font-heading font-extrabold leading-tight text-frenz-ink [overflow-wrap:anywhere]", nameSize)}>{name}</h1>
          {verified ? <VerifiedBadge size={22} /> : null}
          {badges}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[15px] text-frenz-muted">
          <span className="min-w-0 max-w-full [overflow-wrap:anywhere]">@{handle}</span>
          {typeLabel ? (
            <>
              <span aria-hidden>·</span>
              <span className="rounded-md bg-frenz-violet/10 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.4px] text-frenz-violet">{typeLabel}</span>
            </>
          ) : null}
        </div>
        {extras}
      </div>

      {bio || website || joined ? (
        <div className="flex flex-col gap-1.5">
          {bio ? <p className="m-0 text-base leading-[1.45] text-frenz-ink/90">{bio}</p> : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-frenz-muted">
            {website ? (
              <a href={website} target="_blank" rel="nofollow noopener" className="font-semibold text-frenz-blue hover:underline">
                {website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <CalendarIcon size={14} />
              {joined}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** The design's white stats card: four figures, Followers / Following open their lists. */
export function ProfileStats({ stats }: { stats: { label: string; value: number; href?: string }[] }) {
  return (
    <div className={cn("mx-5 mt-3.5 grid rounded-[20px] border border-frenz-line bg-frenz-card py-3.5", stats.length >= 5 ? "grid-cols-5" : "grid-cols-4")}>
      {stats.map((s, i) => {
        const inner = (
          <>
            <span className="font-heading text-[19px] font-bold tabular-nums text-frenz-ink">{formatCompactNumber(s.value)}</span>
            <span className="text-xs font-semibold text-frenz-muted">{s.label}</span>
          </>
        );
        const cls = cn("flex min-h-11 flex-col items-center justify-center gap-0.5 no-underline", i > 0 && "border-l border-frenz-line");
        return s.href ? (
          <Link key={s.label} href={s.href} className={cn(cls, "transition active:opacity-70")}>
            {inner}
          </Link>
        ) : (
          <div key={s.label} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/** The row of actions under the stats (Edit profile + Share profile, or a visitor's Follow / Message …). */
export function ProfileActionRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("frenz-ui mx-5 mt-3.5 flex items-center gap-2.5", className)}>{children}</div>;
}

/** The design's dark primary action (Edit profile) — solid ink, not the gradient. */
export const PROFILE_PRIMARY_BUTTON =
  "flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] bg-frenz-ink text-[15px] font-bold text-frenz-page no-underline transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2";
/** The design's white secondary action. */
export const PROFILE_SECONDARY_BUTTON =
  "flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] border border-frenz-line bg-frenz-card text-[15px] font-bold text-frenz-ink no-underline transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet";

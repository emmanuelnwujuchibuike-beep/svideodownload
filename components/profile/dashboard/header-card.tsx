import {
  Award,
  BadgeCheck,
  Briefcase,
  Calendar,
  Camera,
  Link as LinkIcon,
  MapPin,
  MoreHorizontal,
  Share2,
  Zap,
} from "lucide-react";
import Link from "next/link";

import { SoonButton } from "@/components/profile/dashboard/soon";
import { cn } from "@/lib/utils";

/* Illustrative profile — the design's sample identity (owner-provided mockup,
   `public/profile.jpg` / `public/profilemobile.jpg`). Real profile data gets
   wired in a later pass. */
const P = {
  name: "Chris Morgan",
  handle: "chris.morgan",
  bioTags: "Video Creator • Traveler • Dreamer",
  bioLine: "Exploring the world and sharing good vibes ✨",
  joined: "Joined June 2026",
  location: "Lagos, Nigeria",
  website: "frenzsave.com/chris",
  level: 48,
  xp: 12850,
  xpMax: 20000,
  posts: "231",
  followers: "2.8K",
  following: "180",
};

const BADGES = [
  { label: "Verified", icon: BadgeCheck, cls: "bg-blue-500/10 text-blue-600 dark:text-blue-300" },
  { label: "Business", icon: Briefcase, cls: "bg-amber-500/10 text-amber-600 dark:text-amber-300" },
  { label: "Top Creator", icon: Award, cls: "bg-violet-500/10 text-violet-600 dark:text-violet-300" },
];

function Avatar() {
  return (
    <div className="relative w-fit">
      {/* Pink → violet → blue identity ring */}
      <span className="block rounded-full bg-gradient-to-tr from-fuchsia-500 via-violet-500 to-blue-500 p-[3px]">
        <span className="block rounded-full bg-card p-[3px]">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-blue-600 text-3xl font-bold text-white sm:h-28 sm:w-28 sm:text-4xl">
            CM
          </span>
        </span>
      </span>
      <SoonButton
        feature="Change photo"
        ariaLabel="Change profile photo"
        className="absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-card text-foreground shadow-md ring-1 ring-border transition hover:bg-secondary"
      >
        <Camera className="h-4 w-4" />
      </SoonButton>
    </div>
  );
}

function LevelCard({ className }: { className?: string }) {
  const pct = Math.round((P.xp / P.xpMax) * 100);
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3", className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-sm">
        <Zap className="h-[18px] w-[18px] fill-white" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Level {P.level}</p>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {P.xp.toLocaleString()} / {P.xpMax.toLocaleString()} XP
        </p>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-2 py-1 text-center">
      <p className="text-lg font-extrabold tracking-tight">{value}</p>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

export function ProfileHeaderCard() {
  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
      {/* Cover */}
      <div className="relative h-40 w-full overflow-hidden sm:h-52 lg:h-60">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-400 via-rose-500 to-indigo-700" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_80%_-10%,rgba(255,255,255,0.35),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_20%_120%,rgba(0,0,0,0.35),transparent_50%)]" />
        <div className="absolute right-3 top-3 flex items-center gap-2 pt-[var(--frenz-safe-top)] sm:pt-0">
          <SoonButton
            feature="Edit cover"
            className="inline-flex items-center gap-1.5 rounded-xl bg-black/35 px-3 py-2 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-black/50"
          >
            <Camera className="h-4 w-4" /> Edit Cover
          </SoonButton>
          <SoonButton
            feature="More options"
            ariaLabel="More options"
            className="hidden h-9 w-9 items-center justify-center rounded-xl bg-black/35 text-white backdrop-blur-md transition hover:bg-black/50 sm:inline-flex"
          >
            <MoreHorizontal className="h-5 w-5" />
          </SoonButton>
        </div>
      </div>

      <div className="px-4 pb-5 sm:px-6 lg:px-8">
        {/* Avatar + top-right actions */}
        <div className="flex items-start justify-between gap-4">
          <div className="-mt-12 sm:-mt-16">
            <Avatar />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <SoonButton
              feature="Edit profile"
              className="hidden rounded-xl border border-border px-4 py-2 text-sm font-semibold transition hover:bg-secondary lg:inline-flex"
            >
              Edit Profile
            </SoonButton>
            <SoonButton
              feature="Share profile"
              ariaLabel="Share profile"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-foreground transition hover:bg-secondary"
            >
              <Share2 className="h-[18px] w-[18px]" />
            </SoonButton>
            <SoonButton
              feature="More options"
              ariaLabel="More options"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-foreground transition hover:bg-secondary lg:hidden"
            >
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </SoonButton>
          </div>
        </div>

        {/* Identity + (desktop) level card */}
        <div className="mt-3 gap-6 lg:flex lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-[-0.02em] sm:text-3xl">
              {P.name}
              <BadgeCheck className="h-6 w-6 shrink-0 fill-blue-500 text-white" />
            </h1>
            <p className="mt-0.5 text-muted-foreground">@{P.handle}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {BADGES.map((b) => (
                <span
                  key={b.label}
                  className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold", b.cls)}
                >
                  <b.icon className="h-4 w-4" /> {b.label}
                </span>
              ))}
            </div>

            <p className="mt-3 text-[15px] font-medium">{P.bioTags}</p>
            <p className="mt-0.5 text-[15px] text-foreground/80">{P.bioLine}</p>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" /> {P.joined}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" /> {P.location}
              </span>
              <Link href="/" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                <LinkIcon className="h-4 w-4" /> {P.website}
              </Link>
            </div>
          </div>

          {/* Desktop: level card sits to the right */}
          <LevelCard className="mt-4 hidden w-72 shrink-0 lg:mt-0 lg:flex" />
        </div>

        {/* Mobile / tablet: Level + Posts / Followers / Following in one divided row */}
        <div className="mt-4 flex items-stretch rounded-2xl border border-border/70 bg-secondary/30 lg:hidden">
          <div className="flex flex-1 items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white">
              <Zap className="h-[18px] w-[18px] fill-white" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Level {P.level}</p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: "64%" }} />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {P.xp.toLocaleString()} / {P.xpMax.toLocaleString()} XP
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border/70 border-l border-border/70">
            <Stat value={P.posts} label="Posts" />
            <Stat value={P.followers} label="Followers" />
            <Stat value={P.following} label="Following" />
          </div>
        </div>
      </div>
    </section>
  );
}

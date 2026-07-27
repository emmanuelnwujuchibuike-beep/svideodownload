import { Award, BadgeCheck, Briefcase, Calendar, Camera, Crown, Link as LinkIcon, MapPin, MoreHorizontal, Share2, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ComponentType } from "react";

import { SoonButton } from "@/components/profile/dashboard/soon";
import { cn, formatCompactNumber } from "@/lib/utils";

type Count = number | string;

export type ProfileHeaderProps = {
  name?: string;
  handle?: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  verified?: boolean;
  plan?: string;
  bio?: string | null;
  website?: string | null;
  location?: string | null;
  joined?: string;
  followers?: Count;
  following?: Count;
  friends?: Count;
  posts?: Count;
  /** XP is a gamification feature that isn't built yet — illustrative for now. */
  level?: number;
};

const fmt = (v?: Count) => (typeof v === "number" ? formatCompactNumber(v) : (v ?? "0"));

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

type BadgeSpec = { label: string; icon: ComponentType<{ className?: string }>; cls: string };

function badgesFor(verified: boolean, plan?: string): BadgeSpec[] {
  const out: BadgeSpec[] = [];
  if (verified) out.push({ label: "Verified", icon: BadgeCheck, cls: "bg-blue-500/10 text-blue-600 dark:text-blue-300" });
  if (plan === "business") out.push({ label: "Business", icon: Briefcase, cls: "bg-amber-500/10 text-amber-600 dark:text-amber-300" });
  else if (plan && plan !== "free") out.push({ label: "Pro", icon: Crown, cls: "bg-amber-500/10 text-amber-600 dark:text-amber-300" });
  if (verified) out.push({ label: "Top Creator", icon: Award, cls: "bg-violet-500/10 text-violet-600 dark:text-violet-300" });
  return out;
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  return (
    <div className="relative w-fit">
      <span className="block rounded-full bg-gradient-to-tr from-fuchsia-500 via-violet-500 to-blue-500 p-[3px]">
        <span className="block rounded-full bg-card p-[3px]">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt=""
              width={112}
              height={112}
              className="h-20 w-20 rounded-full object-cover sm:h-24 sm:w-24"
            />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-blue-600 text-2xl font-bold text-white sm:h-24 sm:w-24 sm:text-3xl">
              {initials(name)}
            </span>
          )}
        </span>
      </span>
      <Link
        href="/account#profile"
        aria-label="Change profile photo"
        className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-card text-foreground shadow-md ring-1 ring-border transition hover:bg-secondary"
      >
        <Camera className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-2 py-1 text-center">
      <p className="text-base font-bold tracking-tight">{value}</p>
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

export function ProfileHeaderCard(props: ProfileHeaderProps) {
  const {
    name = "Your Name",
    handle = "you",
    avatarUrl = null,
    bannerUrl = null,
    verified = false,
    plan = "free",
    bio = null,
    website = null,
    location = null,
    joined = "Joined recently",
    followers = 0,
    following = 0,
    posts = 0,
    level = 48,
  } = props;

  const badges = badgesFor(verified, plan);

  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
      {/* Cover */}
      <div className="relative h-32 w-full overflow-hidden sm:h-44 lg:h-52">
        {bannerUrl ? (
          <Image src={bannerUrl} alt="" fill sizes="(max-width: 1120px) 100vw, 1120px" className="object-cover" />
        ) : (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-amber-400 via-rose-500 to-indigo-700" />
            <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_80%_-10%,rgba(255,255,255,0.35),transparent_45%)]" />
          </>
        )}
        <div className="absolute right-3 top-3 flex items-center gap-2 pt-[var(--frenz-safe-top)] sm:pt-0">
          <SoonButton
            feature="Edit cover"
            className="inline-flex items-center gap-1.5 rounded-xl bg-black/35 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-black/50"
          >
            <Camera className="h-3.5 w-3.5" /> Edit Cover
          </SoonButton>
          <SoonButton
            feature="More options"
            ariaLabel="More options"
            className="hidden h-8 w-8 items-center justify-center rounded-xl bg-black/35 text-white backdrop-blur-md transition hover:bg-black/50 sm:inline-flex"
          >
            <MoreHorizontal className="h-4 w-4" />
          </SoonButton>
        </div>
      </div>

      <div className="px-4 pb-4 sm:px-6 lg:px-7">
        {/* Avatar + top-right actions */}
        <div className="flex items-start justify-between gap-4">
          <div className="-mt-10 sm:-mt-14">
            <Avatar name={name} avatarUrl={avatarUrl} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Link
              href="/account#profile"
              className="hidden rounded-xl border border-border px-3.5 py-1.5 text-sm font-semibold transition hover:bg-secondary lg:inline-flex"
            >
              Edit Profile
            </Link>
            <SoonButton
              feature="Share profile"
              ariaLabel="Share profile"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-foreground transition hover:bg-secondary"
            >
              <Share2 className="h-4 w-4" />
            </SoonButton>
            <SoonButton
              feature="More options"
              ariaLabel="More options"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-foreground transition hover:bg-secondary lg:hidden"
            >
              <MoreHorizontal className="h-4 w-4" />
            </SoonButton>
          </div>
        </div>

        {/* Identity + (desktop) level card */}
        <div className="mt-3 gap-6 lg:flex lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 text-xl font-bold tracking-[-0.02em] sm:text-2xl">
              {name}
              {verified ? <BadgeCheck className="h-5 w-5 shrink-0 fill-blue-500 text-white" /> : null}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">@{handle}</p>

            {badges.length ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {badges.map((b) => (
                  <span key={b.label} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", b.cls)}>
                    <b.icon className="h-3.5 w-3.5" /> {b.label}
                  </span>
                ))}
              </div>
            ) : null}

            {bio ? <p className="mt-2.5 text-sm text-foreground/85">{bio}</p> : null}

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> {joined}
              </span>
              {location ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> {location}
                </span>
              ) : null}
              {website ? (
                <a href={website} target="_blank" rel="nofollow noopener" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <LinkIcon className="h-3.5 w-3.5" /> {website.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
            </div>
          </div>

          {/* Desktop: level card sits to the right */}
          <div className="mt-4 hidden w-64 shrink-0 items-center gap-3 rounded-2xl border border-border/70 bg-secondary/30 px-4 py-2.5 lg:mt-0 lg:flex">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white">
              <Zap className="h-4 w-4 fill-white" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Level {level}</p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: "64%" }} />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">12,850 / 20,000 XP</p>
            </div>
          </div>
        </div>

        {/* Mobile / tablet: Level + Posts / Followers / Following in one divided row */}
        <div className="mt-4 flex items-stretch rounded-2xl border border-border/70 bg-secondary/30 lg:hidden">
          <div className="flex flex-1 items-center gap-2.5 px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white">
              <Zap className="h-4 w-4 fill-white" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold">Level {level}</p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: "64%" }} />
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">12,850 / 20,000 XP</p>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border/70 border-l border-border/70">
            <Stat value={fmt(posts)} label="Posts" />
            <Stat value={fmt(followers)} label="Followers" />
            <Stat value={fmt(following)} label="Following" />
          </div>
        </div>
      </div>
    </section>
  );
}

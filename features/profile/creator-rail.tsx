import {
  BarChart3,
  Cake,
  DollarSign,
  LayoutDashboard,
  Link as LinkIcon,
  MapPin,
  Megaphone,
  MessageCircle,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { SoonButton } from "@/components/profile/dashboard/soon";
import { ThemeToggle } from "@/components/theme-toggle";
import { AchievementsShowcase } from "@/features/profile/achievements-showcase";
import { CreatorActivity } from "@/features/profile/creator-activity";
import { IdentityAnalytics, type IdentityAnalyticsData, type TopContent } from "@/features/profile/identity-analytics";
import { LifeJourneyCard } from "@/features/profile/life-journey-card";
import { PrivateJournalCard } from "@/features/profile/private-journal-card";
import { HealthCard } from "@/features/profile/health-card";
import { ReputationCard } from "@/features/profile/reputation-card";
import { TimeCapsuleCard } from "@/features/profile/time-capsule-card";
import type { ActivityRow } from "@/features/profile/activity-map";
import type { EarnedAchievement } from "@/lib/social/achievements";
import type { JournalEntry } from "@/lib/social/journal";
import type { JourneyEntry } from "@/lib/social/life-journey";
import type { ProfileHealth } from "@/lib/profile/health";
import type { Reputation } from "@/lib/social/reputation";
import type { TimeCapsule } from "@/lib/social/time-capsules";
import { cn } from "@/lib/utils";

/**
 * The creator profile's right rail (design: public/mainprofile.jpg) — About Me,
 * Creator Tools, Achievements, Top Friends and Recent Activity. Everything is
 * REAL: About Me is the owner's profile, Top Friends are real friends, Recent
 * Activity is the owner's live notification stream, and each Achievement lights
 * up only once the owner's REAL stats reach its milestone (locked otherwise — no
 * fabricated accomplishments). Only product-ecosystem tools (Monetization / Ad
 * Center) announce "coming soon".
 */

export interface CreatorRailProps {
  bio: string | null;
  location?: string | null;
  website?: string | null;
  joined: string;
  className?: string;
  /** Real top friends (avatar initials + handle); empty renders a friendly hint. */
  friends?: { name: string; handle: string; avatarUrl: string | null }[];
  /** The owner's REAL recent notifications, mapped to activity rows (server-seeded). */
  activity?: ActivityRow[];
  /** Derived achievements (earned/locked from real signals) — the trophy showcase. */
  achievements?: EarnedAchievement[];
  /** REAL engagement totals for the Identity Analytics™ panel (owner-only). */
  analytics?: IdentityAnalyticsData;
  /** The owner's highest-viewed post, for the Content Performance highlight. */
  topContent?: TopContent | null;
  /** The owner's derived Reputation (rank, trust index, progress). */
  reputation?: Reputation;
  /** Profile Health Score (Part 15) — owner-only, never shown to a visitor. */
  health?: ProfileHealth;
  /** The owner's Life Journey™ — real dated milestones + current-state highlights. */
  journey?: JourneyEntry[];
  /** The owner's real, persisted Time Capsules (locked ones carry no message). */
  timeCapsules?: TimeCapsule[];
  /** The owner's real, persisted private journal entries. Never shown to a visitor. */
  journalEntries?: JournalEntry[];
}

/**
 * A section's single accent (lux brief, 2026-08-04).
 *
 * "Never color the whole card. Only use: icon / top border / left accent /
 * progress bar / badge." So this is a left spine and nothing else — and only
 * the sections the brief names get one. Profile Health and Reputation stay
 * neutral on purpose: accenting everything is how a palette turns into a
 * rainbow, and then no accent means anything.
 */
export const RAIL_ACCENTS = {
  about: "#2563FF",
  journey: "#6D5CFF",
  analytics: "#4F46E5",
  journal: "#A78BFA",
  capsule: "#6D5CFF",
  tools: "#2563FF",
  achievements: "#F59E0B",
} as const;

function Accented({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="lux-accent-left overflow-hidden rounded-3xl" style={{ "--lux-accent": color } as React.CSSProperties}>
      {children}
    </div>
  );
}

function Card({
  title,
  viewAll,
  accent,
  children,
}: {
  title: string;
  viewAll?: { feature: string; href?: string };
  accent?: string;
  children: React.ReactNode;
}) {
  const card = (
    <section className="lux-lift lux-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">{title}</h2>
        {viewAll ? (
          viewAll.href ? (
            <Link href={viewAll.href} className="text-xs font-semibold text-primary hover:text-primary/80">View All</Link>
          ) : (
            <SoonButton feature={viewAll.feature} className="text-xs font-semibold text-primary hover:text-primary/80">View All</SoonButton>
          )
        ) : null}
      </div>
      {children}
    </section>
  );
  return accent ? <Accented color={accent}>{card}</Accented> : card;
}

const TOOLS: { title: string; sub: string; icon: LucideIcon; tile: string; href?: string; feature: string }[] = [
  { title: "Settings", sub: "Account, privacy & appearance", icon: Settings, tile: "from-slate-500 to-slate-700", href: "/account", feature: "Settings" },
  { title: "Creator Dashboard", sub: "Manage your profile", icon: LayoutDashboard, tile: "from-violet-500 to-purple-600", href: "/account/identity", feature: "Creator Dashboard" },
  { title: "Analytics", sub: "Track performance", icon: BarChart3, tile: "from-sky-500 to-blue-600", href: "/account/analytics", feature: "Analytics" },
  { title: "Monetization", sub: "Earn from your content", icon: DollarSign, tile: "from-emerald-500 to-teal-600", feature: "Monetization" },
  { title: "Ad Center", sub: "Create and manage ads", icon: Megaphone, tile: "from-amber-500 to-orange-600", feature: "Ad Center" },
];

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "U";
  return (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 text-xs font-bold text-white">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

export function CreatorRail({
  bio,
  location,
  website,
  joined,
  friends = [],
  activity = [],
  achievements,
  analytics,
  topContent = null,
  reputation,
  health,
  journey,
  timeCapsules,
  journalEntries,
  className,
}: CreatorRailProps) {
  return (
    <aside className={cn("w-full space-y-4", className)}>
      {/* About Me */}
      <Card title="About Me" accent={RAIL_ACCENTS.about}>
        {bio ? <p className="text-sm leading-relaxed">{bio}</p> : null}
        <ul className={cn("space-y-2.5 text-sm text-muted-foreground", bio && "mt-3")}>
          <li className="flex items-center gap-2.5"><UserRound className="h-4 w-4 shrink-0" /> Content Creator</li>
          {location ? <li className="flex items-center gap-2.5"><MapPin className="h-4 w-4 shrink-0" /> {location}</li> : null}
          {website ? (
            <li className="flex items-center gap-2.5">
              <LinkIcon className="h-4 w-4 shrink-0" />
              <a href={website} target="_blank" rel="nofollow noopener" className="truncate text-primary hover:underline">
                {website.replace(/^https?:\/\//, "")}
              </a>
            </li>
          ) : null}
          <li className="flex items-center gap-2.5"><Cake className="h-4 w-4 shrink-0" /> {joined}</li>
        </ul>
      </Card>

      {/* Appearance — dark / light / system theme. Restored to the owner rail:
          the creator profile returns before the ProfileMenu that used to host it,
          so it lived nowhere on the owner's own profile after the redesign. */}
      <Card title="Appearance">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
      </Card>

      {/* Profile Health™ (Part 15) — the owner's own score and the one thing
          worth doing next. Above Reputation on purpose: reputation describes
          where you stand, health tells you what to DO. */}
      {health ? <HealthCard health={health} /> : null}

      {/* Reputation™ — derived rank, trust index + progress toward next rank */}
      {reputation ? <ReputationCard reputation={reputation} /> : null}

      {/* Life Journey™ — real dated milestones + current-state highlights */}
      {journey ? <Accented color={RAIL_ACCENTS.journey}><LifeJourneyCard entries={journey} /></Accented> : null}

      {/* Time Capsule™ — real, persisted, sealed until a future date */}
      {timeCapsules ? <Accented color={RAIL_ACCENTS.capsule}><TimeCapsuleCard initialCapsules={timeCapsules} /></Accented> : null}

      {/* Private Journal — real, persisted, never shown to a visitor */}
      {journalEntries ? <Accented color={RAIL_ACCENTS.journal}><PrivateJournalCard initialEntries={journalEntries} /></Accented> : null}

      {/* Identity Analytics™ — REAL engagement (animated) + best content */}
      {analytics ? <Accented color={RAIL_ACCENTS.analytics}><IdentityAnalytics data={analytics} topContent={topContent} /></Accented> : null}

      {/* Creator Tools */}
      <Card title="Creator Tools" accent={RAIL_ACCENTS.tools}>
        <ul className="space-y-1">
          {TOOLS.map((t) => {
            const inner = (
              <>
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", t.tile)}>
                  <t.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{t.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{t.sub}</span>
                </span>
              </>
            );
            const cls = "flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-secondary/50";
            return (
              <li key={t.title}>
                {t.href ? (
                  <Link href={t.href} className={cls}>{inner}</Link>
                ) : (
                  <SoonButton feature={t.feature} className={cls}>{inner}</SoonButton>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Achievements — premium digital-trophy showcase, earned/locked from REAL signals */}
      {achievements ? (
        <Accented color={RAIL_ACCENTS.achievements}>
          <AchievementsShowcase achievements={achievements} />
        </Accented>
      ) : null}

      {/* Top Friends */}
      <Card title="Top Friends" viewAll={{ feature: "Friends", href: "/friends" }}>
        {friends.length ? (
          <ul className="space-y-1">
            {friends.slice(0, 5).map((f) => (
              <li key={f.handle} className="flex items-center gap-3 py-1.5">
                <Avatar name={f.name} url={f.avatarUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{f.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">@{f.handle}</span>
                </span>
                <Link href="/messages" aria-label={`Message ${f.name}`} className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary/70 text-muted-foreground transition hover:text-foreground">
                  <MessageCircle className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-1 text-sm text-muted-foreground">
            Add friends to see them here. <Link href="/friends" className="font-semibold text-primary hover:underline">Find friends</Link>
          </p>
        )}
      </Card>

      {/* Recent Activity — the owner's REAL notifications, updated live */}
      <Card title="Recent Activity" viewAll={{ feature: "Activity", href: "/notifications" }}>
        <CreatorActivity initial={activity} />
      </Card>
    </aside>
  );
}

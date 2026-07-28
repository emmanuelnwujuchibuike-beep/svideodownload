import {
  BarChart3,
  Cake,
  DollarSign,
  Flame,
  LayoutDashboard,
  Link as LinkIcon,
  Lock,
  MapPin,
  Megaphone,
  MessageCircle,
  TrendingUp,
  Trophy,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { SoonButton } from "@/components/profile/dashboard/soon";
import { CreatorActivity } from "@/features/profile/creator-activity";
import { IdentityAnalytics, type IdentityAnalyticsData, type TopContent } from "@/features/profile/identity-analytics";
import { ReputationCard } from "@/features/profile/reputation-card";
import type { ActivityRow } from "@/features/profile/activity-map";
import type { Reputation } from "@/lib/social/reputation";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * The creator profile's right rail (design: public/mainprofile.jpg) — About Me,
 * Creator Tools, Achievements, Top Friends and Recent Activity. Everything is
 * REAL: About Me is the owner's profile, Top Friends are real friends, Recent
 * Activity is the owner's live notification stream, and each Achievement lights
 * up only once the owner's REAL stats reach its milestone (locked otherwise — no
 * fabricated accomplishments). Only product-ecosystem tools (Monetization / Ad
 * Center) announce "coming soon".
 */

export interface CreatorStats {
  posts: number;
  followers: number;
  likes: number;
  views: number;
}

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
  /** The owner's REAL totals — drive which achievements are earned vs locked. */
  stats: CreatorStats;
  /** REAL engagement totals for the Identity Analytics™ panel (owner-only). */
  analytics?: IdentityAnalyticsData;
  /** The owner's highest-viewed post, for the Content Performance highlight. */
  topContent?: TopContent | null;
  /** The owner's derived Reputation (rank, trust index, progress). */
  reputation?: Reputation;
}

function Card({ title, viewAll, children }: { title: string; viewAll?: { feature: string; href?: string }; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
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
}

const TOOLS: { title: string; sub: string; icon: LucideIcon; tile: string; href?: string; feature: string }[] = [
  { title: "Creator Dashboard", sub: "Manage your profile", icon: LayoutDashboard, tile: "from-violet-500 to-purple-600", href: "/account", feature: "Creator Dashboard" },
  { title: "Analytics", sub: "Track performance", icon: BarChart3, tile: "from-sky-500 to-blue-600", href: "/account/analytics", feature: "Analytics" },
  { title: "Monetization", sub: "Earn from your content", icon: DollarSign, tile: "from-emerald-500 to-teal-600", feature: "Monetization" },
  { title: "Ad Center", sub: "Create and manage ads", icon: Megaphone, tile: "from-amber-500 to-orange-600", feature: "Ad Center" },
];

// Each badge lights up only when the owner's REAL stat reaches its milestone —
// `earned` is computed from live totals, never assumed. A brand-new creator sees
// them honestly locked (with the target), not falsely awarded.
type Achievement = { title: string; icon: LucideIcon; tile: string; need: number; stat: keyof CreatorStats; unit: string };
const ACHIEVEMENTS: Achievement[] = [
  { title: "Top Creator", icon: Trophy, tile: "from-violet-500 to-purple-700", need: 1_000_000, stat: "views", unit: "views" },
  { title: "Trend Setter", icon: TrendingUp, tile: "from-blue-500 to-indigo-700", need: 1_000, stat: "followers", unit: "followers" },
  { title: "Viral Star", icon: Flame, tile: "from-amber-400 to-orange-600", need: 100_000, stat: "likes", unit: "likes" },
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

export function CreatorRail({ bio, location, website, joined, friends = [], activity = [], stats, analytics, topContent = null, reputation, className }: CreatorRailProps) {
  return (
    <aside className={cn("w-full space-y-4", className)}>
      {/* About Me */}
      <Card title="About Me">
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

      {/* Reputation™ — derived rank, trust index + progress toward next rank */}
      {reputation ? <ReputationCard reputation={reputation} /> : null}

      {/* Identity Analytics™ — REAL engagement (animated) + best content */}
      {analytics ? <IdentityAnalytics data={analytics} topContent={topContent} /> : null}

      {/* Creator Tools */}
      <Card title="Creator Tools">
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

      {/* Achievements — earned/locked from REAL totals */}
      <Card title="Achievements">
        <div className="grid grid-cols-3 gap-2">
          {ACHIEVEMENTS.map((a) => {
            const have = stats[a.stat];
            const earned = have >= a.need;
            return (
              <div key={a.title} className="flex flex-col items-center gap-2 text-center">
                <span className="relative flex h-12 w-12 items-center justify-center">
                  <span
                    className={cn(
                      "absolute inset-0 rounded-full bg-gradient-to-br shadow-md ring-1 ring-inset ring-white/20",
                      earned ? a.tile : "from-muted to-muted opacity-60 grayscale",
                    )}
                  />
                  <a.icon className={cn("relative h-5 w-5", earned ? "text-white" : "text-muted-foreground")} />
                  {!earned ? (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card ring-1 ring-border">
                      <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                    </span>
                  ) : null}
                </span>
                <span className="block text-[11px] font-semibold leading-tight">{a.title}</span>
                <span className="-mt-1.5 block text-[10px] text-muted-foreground">
                  {earned ? "Earned" : `${formatCompactNumber(a.need)} ${a.unit}`}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

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

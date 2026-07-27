import {
  BarChart3,
  Cake,
  DollarSign,
  Eye,
  Flame,
  LayoutDashboard,
  Link as LinkIcon,
  MapPin,
  Megaphone,
  MessageCircle,
  Play,
  Sparkles,
  TrendingUp,
  Trophy,
  UserPlus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { SoonButton } from "@/components/profile/dashboard/soon";
import { cn } from "@/lib/utils";

/**
 * The creator profile's right rail (design: public/mainprofile.jpg) — About Me,
 * Creator Tools, Achievements, Top Friends and Recent Activity. "About Me" uses
 * the viewer's REAL profile; Analytics links to the real page; tools without a
 * backend yet announce "coming soon". Achievements / Recent Activity mirror the
 * design's sample content until their backends ship.
 */

export interface CreatorRailProps {
  bio: string | null;
  location?: string | null;
  website?: string | null;
  joined: string;
  /** Real top friends (avatar initials + handle); empty renders a friendly hint. */
  friends?: { name: string; handle: string; avatarUrl: string | null }[];
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
  { title: "Creator Dashboard", sub: "Manage your profile", icon: LayoutDashboard, tile: "from-violet-500 to-purple-600", feature: "Creator Dashboard" },
  { title: "Analytics", sub: "Track performance", icon: BarChart3, tile: "from-sky-500 to-blue-600", href: "/account/analytics", feature: "Analytics" },
  { title: "Monetization", sub: "Earn from your content", icon: DollarSign, tile: "from-emerald-500 to-teal-600", feature: "Monetization" },
  { title: "Ad Center", sub: "Create and manage ads", icon: Megaphone, tile: "from-amber-500 to-orange-600", feature: "Ad Center" },
];

const ACHIEVEMENTS: { title: string; sub: string; icon: LucideIcon; tile: string }[] = [
  { title: "Top Creator", sub: "1M views", icon: Trophy, tile: "from-violet-500 to-purple-700" },
  { title: "Trend Setter", sub: "For trending content", icon: TrendingUp, tile: "from-blue-500 to-indigo-700" },
  { title: "Viral Star", sub: "For 100K likes", icon: Flame, tile: "from-amber-400 to-orange-600" },
];

/* @sourced illustrative — the design's sample activity, until an events backend exists. */
const ACTIVITY: { icon: LucideIcon; text: string; time: string; tint: string }[] = [
  { icon: Eye, text: "You reached 20K views on your reel", time: "2h ago", tint: "text-sky-500" },
  { icon: UserPlus, text: "You gained 120 new followers", time: "5h ago", tint: "text-emerald-500" },
  { icon: TrendingUp, text: "Your reel is trending", time: "1d ago", tint: "text-violet-500" },
  { icon: Play, text: "Your video reached 10K views", time: "1d ago", tint: "text-rose-500" },
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

export function CreatorRail({ bio, location, website, joined, friends = [] }: CreatorRailProps) {
  return (
    <aside className="hidden w-[320px] shrink-0 space-y-4 xl:block">
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

      {/* Achievements */}
      <Card title="Achievements" viewAll={{ feature: "Achievements" }}>
        <div className="grid grid-cols-3 gap-2">
          {ACHIEVEMENTS.map((a) => (
            <div key={a.title} className="flex flex-col items-center gap-2 text-center">
              <span className="relative flex h-12 w-12 items-center justify-center">
                <span className={cn("absolute inset-0 rounded-full bg-gradient-to-br shadow-md ring-1 ring-inset ring-white/20", a.tile)} />
                <a.icon className="relative h-5 w-5 text-white" />
              </span>
              <span className="block text-[11px] font-semibold leading-tight">{a.title}</span>
              <span className="-mt-1.5 block text-[10px] text-muted-foreground">{a.sub}</span>
            </div>
          ))}
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

      {/* Recent Activity */}
      <Card title="Recent Activity" viewAll={{ feature: "Activity", href: "/notifications" }}>
        <ul className="space-y-3">
          {ACTIVITY.map((a, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/70", a.tint)}>
                <a.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm leading-snug">{a.text}</span>
                <span className="block text-xs text-muted-foreground">{a.time}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
          <Sparkles className="h-3 w-3" /> Activity preview — live updates coming soon
        </p>
      </Card>
    </aside>
  );
}

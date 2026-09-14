"use client";

import { BarChart3, DollarSign, LayoutDashboard, Megaphone, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { SoonButton } from "@/components/profile/dashboard/soon";
import { ThemeToggle } from "@/components/theme-toggle";
import { AchievementsShowcase } from "@/features/profile/achievements-showcase";
import { CreatorActivity } from "@/features/profile/creator-activity";
import { HealthCard } from "@/features/profile/health-card";
import { IdentityAnalytics } from "@/features/profile/identity-analytics";
import { LifeJourneyCard } from "@/features/profile/life-journey-card";
import { AboutPanel, CatalogPanel, HoursPanel, ResumePanel, ShowcasePanel, SkillsPanel } from "@/features/profile/module-panels";
import { PrivateJournalCard } from "@/features/profile/private-journal-card";
import { ReputationCard } from "@/features/profile/reputation-card";
import { TimeCapsuleCard } from "@/features/profile/time-capsule-card";
import { StreakProfileCard } from "@/features/streaks/streak-profile-card";
import type { HubPayload } from "@/lib/profile/hub-data";
import { cn } from "@/lib/utils";

/**
 * The content of each hub section, from the payload the API answered with.
 * Every card is the one that stood on the page before 2026-09-13 — the rail's
 * cards and the engine's panels — rendered unchanged inside the sheet, so
 * nothing a member could see has gone; it has moved behind a button.
 */
export function ProfileHubPanel({ handle, payload }: { handle: string; payload: HubPayload }) {
  switch (payload.key) {
    case "about":
      return <AboutPanel details={payload.details} bio={null} website={null} isOwner={payload.isOwner} handle={payload.handle} />;
    case "achievements":
      return <AchievementsShowcase achievements={payload.achievements} />;
    case "portfolio":
      return <ShowcasePanel kind="project" items={payload.items} isOwner={payload.isOwner} />;
    case "experience":
      return <ShowcasePanel kind="experience" items={payload.items} isOwner={payload.isOwner} />;
    case "education":
      return <ShowcasePanel kind="education" items={payload.items} isOwner={payload.isOwner} />;
    case "certifications":
      return <ShowcasePanel kind="certification" items={payload.items} isOwner={payload.isOwner} />;
    case "awards":
      return <ShowcasePanel kind="award" items={payload.items} isOwner={payload.isOwner} />;
    case "publications":
      return <ShowcasePanel kind="publication" items={payload.items} isOwner={payload.isOwner} />;
    case "skills":
      return <SkillsPanel skills={payload.skills} isOwner={payload.isOwner} />;
    case "resume":
      return <ResumePanel url={payload.url} isOwner={payload.isOwner} />;
    case "catalog":
      return <CatalogPanel kind="product" items={payload.items} isOwner={payload.isOwner} />;
    case "services":
      return <CatalogPanel kind="service" items={payload.items} isOwner={payload.isOwner} />;
    case "hours":
      return <HoursPanel details={payload.details} isOwner={payload.isOwner} />;

    case "streak":
      return <StreakProfileCard />;
    case "reputation":
      return <ReputationCard reputation={payload.reputation} />;
    case "health":
      return payload.health ? (
        <HealthCard health={payload.health} />
      ) : (
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          Your profile health couldn&apos;t be computed right now.
        </p>
      );
    case "analytics":
      return <IdentityAnalytics data={payload.data} topContent={payload.topContent} />;
    case "journey":
      return <LifeJourneyCard entries={payload.entries} />;
    case "capsules":
      return <TimeCapsuleCard initialCapsules={payload.capsules} />;
    case "journal":
      return <PrivateJournalCard initialEntries={payload.entries} />;
    case "friends":
      return <FriendsPanel friends={payload.friends} />;
    case "activity":
      return (
        <section className="lux-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">Recent Activity</h2>
            <Link href="/notifications" className="text-xs font-semibold text-primary hover:text-primary/80">
              View All
            </Link>
          </div>
          <CreatorActivity initial={payload.rows} />
        </section>
      );
    case "tools":
      return <ToolsPanel />;
    case "appearance":
      return (
        <section className="lux-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold">Appearance</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Light, dark, or follow the phone.</p>
            </div>
            <ThemeToggle />
          </div>
        </section>
      );
  }
  void handle;
  return null;
}

/* ───────────────────────────── the rail's own ───────────────────────────── */

const TOOLS: { title: string; sub: string; icon: LucideIcon; tile: string; href?: string; feature: string }[] = [
  { title: "Settings", sub: "Account, privacy & appearance", icon: Settings, tile: "from-slate-500 to-slate-700", href: "/account", feature: "Settings" },
  { title: "Creator Studio", sub: "Content, audience & goals", icon: LayoutDashboard, tile: "from-violet-500 to-purple-600", href: "/studio", feature: "Creator Studio" },
  { title: "Analytics", sub: "Track performance", icon: BarChart3, tile: "from-sky-500 to-blue-600", href: "/account/analytics", feature: "Analytics" },
  { title: "Monetization", sub: "Earn from your content", icon: DollarSign, tile: "from-emerald-500 to-teal-600", feature: "Monetization" },
  { title: "Ad Center", sub: "Create and manage ads", icon: Megaphone, tile: "from-amber-500 to-orange-600", feature: "Ad Center" },
];

function ToolsPanel() {
  return (
    <section className="lux-card p-5">
      <h2 className="mb-3 text-base font-bold">Creator Tools</h2>
      <ul className="space-y-1">
        {TOOLS.map((t) => {
          const cls = "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-secondary/60";
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
          return (
            <li key={t.title}>
              {t.href ? (
                <Link href={t.href} className={cls}>
                  {inner}
                </Link>
              ) : (
                <SoonButton feature={t.feature} className={cls}>
                  {inner}
                </SoonButton>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FriendsPanel({ friends }: { friends: { name: string; handle: string; avatarUrl: string | null }[] }) {
  return (
    <section className="lux-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">Top Friends</h2>
        <Link href="/friends" className="text-xs font-semibold text-primary hover:text-primary/80">
          View All
        </Link>
      </div>
      {friends.length > 0 ? (
        <ul className="space-y-1">
          {friends.map((f) => (
            <li key={f.handle}>
              <Link href={`/u/${f.handle}`} className="flex items-center gap-3 rounded-xl px-1 py-1.5 transition hover:bg-secondary/60">
                <Avatar name={f.name} url={f.avatarUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{f.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">@{f.handle}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No friends yet —{" "}
          <Link href="/friends" className="font-semibold text-primary hover:underline">
            find people you know
          </Link>
          .
        </p>
      )}
    </section>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "U";
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

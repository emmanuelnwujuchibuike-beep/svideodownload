import { BarChart3, Bookmark, Clock, Eye, Heart, MessageCircle, Share2, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreatorAssistant } from "@/features/studio/creator-assistant";
import {
  CommunityWidget,
  EngagementWidget,
  HealthWidget,
  LatestWorkWidget,
  NextMilestoneWidget,
  RecentFollowersWidget,
  SuggestionsWidget,
  WeeklyGoalWidget,
} from "@/features/studio/home-widgets";
import { StudioCustomiser } from "@/features/studio/studio-customiser";
import { DeltaChip, EmptyNote, StatCard, StudioCard } from "@/features/studio/studio-ui";
import { buildCreatorContext } from "@/lib/creator/assistant-context";
import { getStudioPrefs } from "@/lib/creator/prefs";
import { getCreatorHome } from "@/lib/creator/studio";
import type { MetricId } from "@/lib/creator/widgets";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Home" };

/**
 * Creator Home (Feature 15 · Part 9).
 *
 * ── Server-rendered, and deliberately not live ──────────────────────────
 * Every number here is fetched once per navigation. No polling, no SSE, no
 * `setInterval` — the same rule `features/admin/` carries, for the same reason:
 * a dashboard that refreshes itself bills continuous compute for a page someone
 * looks at for thirty seconds. "Real time" is served by the data being fresh on
 * arrival, which for a creator checking numbers a few times a day is
 * indistinguishable and costs nothing between visits.
 *
 * ── The layout is the creator's ─────────────────────────────────────────
 * `prefs.layout` decides which cards render and in what order. A hidden card is
 * never constructed at all, so hiding one genuinely costs nothing rather than
 * being display:none.
 */
export default async function StudioHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio");

  const prefs = await getStudioPrefs(user.id);
  const home = await getCreatorHome(user.id, prefs.weeklyGoal);

  if (!home) {
    return (
      <EmptyNote>
        The Studio can&apos;t reach your data right now. Nothing is lost — try again in a moment.
      </EmptyNote>
    );
  }

  const { analytics } = home;

  // Only the metrics the creator pinned, in the order they pinned them.
  const METRIC: Record<MetricId, { label: string; icon: typeof Eye; value: number | null; suffix?: string; delta?: number }> = {
    views: { label: "Views today", icon: Eye, value: home.views.today, delta: home.views.change },
    followers: { label: "New followers today", icon: Users, value: home.followers.today, delta: home.followers.change },
    engagementRate: { label: "Engagement rate", icon: Heart, value: analytics.engagementRate, suffix: "%" },
    retention: {
      label: "Watch-through",
      // 🔴 null, not 0, when nothing has been measured — an em-dash says "not
      // measured", a zero says "nobody watched", and they are different claims.
      value: analytics.discovery.retention > 0 ? analytics.discovery.retention : null,
      icon: Clock,
      suffix: "%",
    },
    posts: { label: "Posts", icon: BarChart3, value: analytics.totals.posts },
    comments: { label: "Comments today", icon: MessageCircle, value: home.engagement.today, delta: home.engagement.change },
    shares: { label: "Shares", icon: Share2, value: analytics.totals.shares },
    saves: { label: "Saves", icon: Bookmark, value: analytics.totals.saves },
  };

  const assistantContext = prefs.layout.includes("assistant") ? await buildCreatorContext(user.id) : "";

  const widgets: Record<string, React.ReactNode> = {
    performance: (
      <div key="performance" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {prefs.pinnedMetrics.map((id) => {
          const m = METRIC[id];
          return (
            <StatCard
              key={id}
              icon={m.icon}
              label={m.label}
              value={m.value}
              suffix={m.suffix}
              delta={m.delta}
              accent={id === prefs.pinnedMetrics[0]}
            />
          );
        })}
      </div>
    ),
    goal: <WeeklyGoalWidget key="goal" goal={home.goal} />,
    latest: <LatestWorkWidget key="latest" latest={home.latest} />,
    milestone: <NextMilestoneWidget key="milestone" step={home.nextStep} />,
    engagement: <EngagementWidget key="engagement" analytics={analytics} />,
    followers: <RecentFollowersWidget key="followers" followers={home.recentFollowers} />,
    lounge: <CommunityWidget key="lounge" lounge={home.lounge} />,
    health: <HealthWidget key="health" health={home.health} />,
    suggestions: <SuggestionsWidget key="suggestions" suggestions={home.suggestions} />,
    assistant: assistantContext ? <CreatorAssistant key="assistant" context={assistantContext} /> : null,
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Creator Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Today against yesterday, and everything you&apos;ve made.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {home.scheduledCount > 0 ? (
            <Link
              href="/studio/calendar"
              prefetch
              className="inline-flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-xs font-semibold transition hover:bg-secondary/70"
            >
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {home.scheduledCount} scheduled
            </Link>
          ) : null}
          <DeltaChip delta={home.watchThrough.change} suffix="%" />
        </div>
      </header>

      {prefs.layout.map((id) => widgets[id] ?? null)}

      <StudioCard title="Where your reach came from" icon={BarChart3}>
        {analytics.discovery.trafficSources.length === 0 ? (
          <EmptyNote>
            No watch data yet. Traffic sources appear once people start watching your posts — they are
            recorded from the surface that served each view, never modelled.
          </EmptyNote>
        ) : (
          <ul className="space-y-2">
            {analytics.discovery.trafficSources.slice(0, 6).map((s) => (
              <li key={s.source} className="flex items-center justify-between text-xs">
                <span className="font-medium capitalize text-muted-foreground">{s.source.replace(/_/g, " ")}</span>
                <span className="font-semibold tabular-nums">{s.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </StudioCard>

      <StudioCustomiser
        initialOrder={prefs.layout}
        initialHidden={prefs.hiddenWidgets}
        initialMetrics={prefs.pinnedMetrics}
        initialGoal={prefs.weeklyGoal}
      />
    </div>
  );
}

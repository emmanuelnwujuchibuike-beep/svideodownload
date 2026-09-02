import { Clock, Heart, Repeat, TrendingUp, Users } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmptyNote, MeterRow, StatCard, StudioCard } from "@/features/studio/studio-ui";
import { ViewingHours } from "@/features/studio/viewing-hours";
import { getAudienceInsights, MIN_INTEREST_COHORT } from "@/lib/creator/audience";
import { getCreatorLounge } from "@/lib/social/creator-lounge";
import { createClient } from "@/lib/supabase/server";
import { formatCompactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audience" };

/**
 * Audience (Feature 15 · Part 9).
 *
 * ── What is NOT on this page ────────────────────────────────────────────
 * Age, country, city, language and device. None of them are collected anywhere
 * in this product and none can be derived: a view is identified by a viewer id
 * or a HASHED ip and is never resolved to a location, `profiles` has no
 * birthdate, and nothing records a user-agent against a view. Every one of
 * those charts would have to be invented, which this project has declined three
 * times. The section at the bottom says so out loud rather than leaving a
 * creator to wonder why their dashboard is missing what other platforms show.
 */
export default async function StudioAudiencePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/audience");

  const [audience, lounge] = await Promise.all([getAudienceInsights(user.id), getCreatorLounge(user.id, 60)]);

  const followerTrend = audience.trends.find((t) => t.metric === "followers");
  const totalViewers = audience.returningViewers + audience.oneTimeViewers;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Audience</h1>
        <p className="mt-1 text-sm text-muted-foreground">Who is watching, when, and whether they come back.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="New followers, 7 days" value={audience.newFollowers7d} accent />
        <StatCard icon={Users} label="New followers, 30 days" value={audience.newFollowers30d} />
        <StatCard icon={Repeat} label="Returning viewers" value={audience.returningViewers} />
        <StatCard
          icon={Heart}
          label="Loyal fans"
          value={audience.loyalFans}
          hint="Watched on 3+ separate days"
        />
      </div>

      <StudioCard title="Growth" icon={TrendingUp} subtitle="From the daily readings taken since you joined">
        {audience.insufficientHistory ? (
          <EmptyNote>
            Not enough history yet. Growth needs at least two daily readings spanning a real interval — a
            trend drawn from one reading is a decoration, so none is drawn.
          </EmptyNote>
        ) : (
          <div className="space-y-3">
            {audience.trends
              .filter((t) => ["followers", "posts", "collections"].includes(t.metric))
              .map((t) => (
                <div key={t.metric} className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-muted-foreground">{t.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums font-semibold">{formatCompactNumber(t.current)}</span>
                    <span
                      className={
                        t.change > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : t.change < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-muted-foreground"
                      }
                    >
                      {t.change > 0 ? "+" : ""}
                      {t.change}
                      {/* Percent is omitted, not zeroed, when growing from nothing:
                          an infinite percentage is not a useful thing to show. */}
                      {t.changePercent !== null ? ` (${t.changePercent > 0 ? "+" : ""}${t.changePercent}%)` : ""}
                    </span>
                  </span>
                </div>
              ))}
            {followerTrend ? (
              <p className="pt-1 text-[11px] text-muted-foreground">
                Over {followerTrend.spanDays} {followerTrend.spanDays === 1 ? "day" : "days"} of readings.
              </p>
            ) : null}
          </div>
        )}
      </StudioCard>

      <StudioCard
        title="When your audience watches"
        icon={Clock}
        subtitle="Real watch timestamps over the last 90 days, in your local hours"
      >
        <ViewingHours buckets={audience.viewingHours} peak={audience.peakHour} />
      </StudioCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <StudioCard title="Returning vs one-time" icon={Repeat}>
          {totalViewers === 0 ? (
            <EmptyNote>No watch data yet.</EmptyNote>
          ) : (
            <div className="space-y-3">
              <MeterRow
                label="Came back"
                value={audience.returningViewers}
                max={totalViewers}
                display={`${Math.round((audience.returningViewers / totalViewers) * 100)}%`}
                tone="from-emerald-600 to-teal-400"
              />
              <MeterRow
                label="Watched once"
                value={audience.oneTimeViewers}
                max={totalViewers}
                display={`${Math.round((audience.oneTimeViewers / totalViewers) * 100)}%`}
                tone="from-slate-500 to-slate-400"
              />
              {audience.watchSampleTruncated ? (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Based on the most recent 20,000 watches — you have more.
                </p>
              ) : null}
            </div>
          )}
        </StudioCard>

        <StudioCard title="Top supporters" icon={Heart} subtitle="Ranked by comments left on your posts">
          {lounge.topSupporters.length === 0 ? (
            <EmptyNote>Nobody has commented yet.</EmptyNote>
          ) : (
            <ul className="space-y-2">
              {lounge.topSupporters.slice(0, 6).map((s) => (
                <li key={s.author.handle} className="flex items-center gap-3">
                  {s.author.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.author.avatarUrl} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold uppercase">
                      {s.author.handle.slice(0, 2)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{s.author.displayName}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.commentCount}</span>
                </li>
              ))}
            </ul>
          )}
        </StudioCard>
      </div>

      <StudioCard
        title="What your audience is into"
        icon={Users}
        subtitle="Aggregated from your followers' own interest profiles"
      >
        {audience.interests === null ? (
          <EmptyNote>
            {audience.interestCohort < MIN_INTEREST_COHORT ? (
              <>
                Hidden until at least {MIN_INTEREST_COHORT} of your followers have an interest profile — you
                have {audience.interestCohort}. Below that, an &quot;audience&quot; chart would be naming one
                person&apos;s private interests to you.
              </>
            ) : (
              <>Not enough data to aggregate yet.</>
            )}
          </EmptyNote>
        ) : (
          <div className="space-y-3">
            {audience.interests.map((i) => (
              <MeterRow
                key={i.category}
                label={i.label}
                value={Math.round(i.weight * 100)}
                max={100}
                display={`${Math.round(i.weight * 100)}%`}
                tone="from-violet-600 to-fuchsia-500"
              />
            ))}
            <p className="pt-1 text-[11px] text-muted-foreground">
              Aggregated across {audience.interestCohort} followers. Relative strengths, never individuals.
            </p>
          </div>
        )}
      </StudioCard>

      <section className="rounded-3xl border border-dashed border-border/70 p-5 sm:p-6">
        <h2 className="text-sm font-semibold">What this page deliberately does not show</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Age, country, city, language and device breakdowns are absent because none of them are collected
          anywhere in this product. A view is identified by an account id or a hashed IP and is never
          resolved to a location; there is no birthdate on a profile; nothing records a device against a
          view. Those charts could only be produced by inventing them, so they are not here. When your
          audience watches, and whether they come back, are the honest versions of the same question — and
          both are on this page.
        </p>
      </section>
    </div>
  );
}

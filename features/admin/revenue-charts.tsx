"use client";

import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AdminAreaChart, type AreaPoint } from "@/features/admin/area-chart";
import { AdminSectionTabs, AdminTabPanel, type AdminTab } from "@/features/admin/section-tabs";
import type { RevenueSeries } from "@/lib/monetization/revenue-series";
import { cn } from "@/lib/utils";

/**
 * The sticky sub-nav's buttons (owner, 2026-08-23: "the top nav should have
 * buttons like ad impression button, that opens only ad impression chart and
 * all detailed information, and visitors button at the top nav that opens open
 * visitors charts and all detailed information").
 *
 * Grouped by the QUESTION each answers rather than one tab per chart: "Ad
 * impressions" and "Ad clicks" are read together (a click count without its
 * impression count has no meaning, and the CTR needs both), and the three
 * visitor charts are one measure split three ways. A tab per chart would trade
 * one long scroll for a long tab row, which is the same problem wearing a
 * different hat.
 */
const TABS: AdminTab[] = [
  { id: "overview", label: "Overview" },
  { id: "ads", label: "Ads" },
  { id: "visitors", label: "Visitors" },
  { id: "downloads", label: "Downloads" },
  { id: "installs", label: "Installs" },
  { id: "rewards", label: "Reward ads" },
];

/**
 * The revenue & engagement dashboard — a GRID of single-measure panels sharing
 * one date range.
 *
 * ── 🔴 Why this is not one chart with five lines ──────────────────────────
 *
 * The brief asked for subscription revenue, ad revenue, impressions, clicks and
 * visitors "on a graph area chart". Put on one chart those need two y-axes —
 * money against counts, and impressions (tens of thousands) against clicks
 * (tens). A dual axis is the most misleading thing a chart can do, because the
 * author chooses where the lines cross and the reader believes it. Five panels
 * at five honest scales say the same thing without the lie, and reading across
 * a shared x-axis is what makes them comparable.
 *
 * ── 🔴 Two of the five measures have no data, and this says so ────────────
 *
 * AD REVENUE does not exist in this system. Networks report earnings in their
 * own dashboards and we never receive them. `revenue-overview.tsx` already
 * refuses to print an ad-revenue number for that reason, and a TREND would be
 * worse — a line is more persuasive than a figure. It is named here as missing
 * rather than omitted silently, so nobody concludes it was forgotten.
 *
 * SUBSCRIPTION REVENUE is a live snapshot (current subscribers × current
 * prices), not a ledger. Charting it would mean applying today's prices to the
 * past, inventing the very number it claims to report. It stays a stat tile —
 * the honest form for a measure with one value — until daily snapshots exist.
 */
export function RevenueCharts({
  series,
  mrr,
  currency,
  mrrComplete,
  visitors,
  visitorSplit,
}: {
  series: RevenueSeries;
  mrr: number;
  currency: string;
  mrrComplete: boolean;
  /** Daily visitors from the analytics RPC — real buckets, may be absent. */
  visitors?: { date: string; visitors: number }[];
  /**
   * Daily new-vs-returning split — see getVisitorSplitSeries, capped at 30 days.
   * A null count means NOT MEASURED for that day (the un-migrated fallback
   * could not reach it), never zero — those points are dropped below.
   */
  visitorSplit?: { date: string; newVisitors: number | null; returningVisitors: number | null }[];
}) {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  /*
    Which group of panels is on screen. "overview" first because it holds MRR —
    the one figure worth seeing without asking for it — and because a section
    that opens on a filtered view should open on its least surprising one.
  */
  const [tab, setTab] = useState<string>("overview");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The filter narrows an already-fetched window rather than refetching: at 90
  // days this is 90 numbers, and a round-trip to slice an array is latency for
  // nothing.
  const slice = <T,>(arr: T[]) => arr.slice(Math.max(0, arr.length - range));

  const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const impressions: AreaPoint[] = slice(series.days).map((d) => ({ label: fmtDay(d.date), value: d.impressions }));
  const clicks: AreaPoint[] = slice(series.days).map((d) => ({ label: fmtDay(d.date), value: d.clicks }));
  const visits: AreaPoint[] = slice(visitors ?? []).map((d) => ({ label: fmtDay(d.date), value: d.visitors }));
  const downloads: AreaPoint[] = slice(series.days).map((d) => ({ label: fmtDay(d.date), value: d.downloads }));
  const installs: AreaPoint[] = slice(series.days).map((d) => ({ label: fmtDay(d.date), value: d.installs }));
  const rewardsStarted: AreaPoint[] = slice(series.days).map((d) => ({ label: fmtDay(d.date), value: d.rewardsStarted }));
  const rewardsGranted: AreaPoint[] = slice(series.days).map((d) => ({ label: fmtDay(d.date), value: d.rewardsGranted }));
  const multilinkBatches: AreaPoint[] = slice(series.days).map((d) => ({ label: fmtDay(d.date), value: d.multilinkBatches }));
  const multilinkRefused: AreaPoint[] = slice(series.days).map((d) => ({ label: fmtDay(d.date), value: d.multilinkRefused }));
  /*
    🔴 A NULL DAY IS DROPPED, NOT PLOTTED AS ZERO (owner, 2026-08-23:
    "returning visitors in admin is glitching, showing 0"). An unmeasured day
    charted at zero is indistinguishable from a real day with no returning
    visitors, and it also drags the total down — which is how a day whose true
    figure was 52 came to read as 0. Dropping it leaves a visible gap, which is
    the honest rendering of "we could not measure this".
  */
  const definedDays = <K extends "newVisitors" | "returningVisitors">(key: K): AreaPoint[] =>
    slice(visitorSplit ?? [])
      .filter((d): d is (typeof d) & Record<K, number> => d[key] != null)
      .map((d) => ({ label: fmtDay(d.date), value: d[key] }));
  const newVisitors: AreaPoint[] = definedDays("newVisitors");
  const returningVisitors: AreaPoint[] = definedDays("returningVisitors");

  const totalImpr = impressions.reduce((n, p) => n + p.value, 0);
  const totalClicks = clicks.reduce((n, p) => n + p.value, 0);
  const totalDownloads = downloads.reduce((n, p) => n + p.value, 0);
  const totalMultilinkBatches = multilinkBatches.reduce((n, p) => n + p.value, 0);
  const totalMultilinkRefused = multilinkRefused.reduce((n, p) => n + p.value, 0);
  const totalNewVisitors = newVisitors.reduce((n, p) => n + p.value, 0);
  const totalReturningVisitors = returningVisitors.reduce((n, p) => n + p.value, 0);
  const ctr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : null;

  /*
    Installs today / this week / this month (owner, 2026-08-23: "how many
    installs was made that day, week, month").

    Summed off the SAME gap-free daily grid the chart draws, so the tiles and
    the line can never disagree — a separate query for the tiles is how two
    numbers describing one thing start drifting apart, which this dashboard has
    already had to fix once (see the `analytics_downloads` sourcing note in
    lib/monetization/revenue-series.ts).

    Trailing windows, not calendar ones: "last 7 days" is comparable on any day
    of the week, whereas a calendar week reads as a collapse every Monday
    morning for no real reason. `series.days` is UTC and oldest-first, so the
    tail is the most recent N days.
  */
  const tail = (n: number) => series.days.slice(Math.max(0, series.days.length - n));
  const sumInstalls = (n: number) => tail(n).reduce((sum, d) => sum + d.installs, 0);
  const installsToday = sumInstalls(1);
  const installsWeek = sumInstalls(7);
  const installsMonth = sumInstalls(30);

  /*
    Rewarded-ad activity over the SELECTED range, so these read against the
    charts directly beneath them rather than a fixed window that would disagree
    with the line the admin is looking at.

    The completion rate is the point of the pair. It is left null rather than
    shown as 0% when nobody started one — 0% reads as "rewarded ads are
    failing", which is a very different statement from "nobody was offered one
    yet", and this dashboard has a standing rule against printing a number it
    cannot stand behind.
  */
  const totalRewardsStarted = rewardsStarted.reduce((n, p) => n + p.value, 0);
  const totalRewardsGranted = rewardsGranted.reduce((n, p) => n + p.value, 0);
  const rewardCompletion =
    totalRewardsStarted > 0 ? Math.round((totalRewardsGranted / totalRewardsStarted) * 100) : null;

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Revenue &amp; engagement</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every series below is a counted total. Nothing is projected or estimated.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Refresh WITHOUT leaving the section (owner, 2026-08-23: "put a
            refresh button in revenue section so I can refresh revenue stat
            while still inside the section and see current live stat").

            `router.refresh()` re-runs the server components that fetched this
            data and swaps in the result — it does NOT remount the page or reset
            client state, so the selected date range survives and the admin stays
            exactly where they were scrolled. A full reload would lose both, and
            re-fetching only this panel would let it disagree with the revenue
            tiles above it, which read from the same server pass.

            `isPending` comes from a transition, so the spinner reflects the real
            in-flight fetch rather than a timer guessing at one.
          */}
          <button
            type="button"
            onClick={() => startTransition(() => router.refresh())}
            disabled={isPending}
            aria-label="Refresh revenue statistics"
            className="inline-flex items-center gap-1.5 rounded-xl bg-secondary/50 px-3 py-2 text-xs font-semibold transition hover:bg-secondary disabled:opacity-60"
          >
            <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", isPending && "animate-spin")} />
            {isPending ? "Refreshing…" : "Refresh"}
          </button>

          {/* Filters in ONE row above the charts, and they drive every panel — a
              per-panel range would let two charts disagree about the window. */}
          <div role="group" aria-label="Date range" className="flex items-center gap-1 rounded-xl bg-secondary/50 p-1">
            {([7, 30, 90] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  range === r ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {series.capped ? (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This window hit the read limit, so the earliest days are partial. The shape of the recent
          days is accurate; the totals are a floor, not the whole count.
        </p>
      ) : null}

      {/*
        🔴 STICKY SUB-NAV (owner, 2026-08-23, asked three times): "in revenue,
        there should be a top nav that sticks at the top when scrolled, and the
        top nav should have buttons like ad impression button, that opens only
        ad impression chart and all detailed information, and visitors button
        ... so i can easily locate them each by their at the top without
        scrolling down too much."

        Every panel below used to render at once, in one long grid — eleven
        charts and three detail blocks, which is precisely the "scrolling down
        too much" being reported. Each tab now shows ONE group and hides the
        rest, so the section is only as tall as what was asked for. See
        section-tabs.tsx for why these filter rather than scroll to anchors.

        The date range and Refresh stay ABOVE the bar, outside the tabs,
        because they apply to every panel — moving them inside would imply they
        were per-tab, and a range that silently differed between tabs is
        exactly the disagreement the single filter row was added to prevent.
      */}
      <AdminSectionTabs tabs={TABS} active={tab} onChange={setTab} />

      <AdminTabPanel id="overview" active={tab} className="grid gap-4 lg:grid-cols-2">
        {/*
          MRR as a STAT TILE, not a chart. It is one value with no history —
          "sometimes the answer is not a chart" is exactly this case, and drawing
          a flat line across 30 identical points would imply a stability nobody
          measured.
        */}
        <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] to-transparent p-4">
          <p className="text-xs font-medium text-muted-foreground">Subscription revenue (MRR)</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">
            {currency}
            {mrr.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {mrrComplete
              ? "Live subscriber counts × the prices set on the pricing screen."
              : "Partial — one plan has a non-numeric price and is excluded from this total."}
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
            Shown as a figure rather than a trend: this is a snapshot of today, and no per-day
            history has ever been recorded to plot against.
          </p>
        </div>

        {/*
          🔴 AD REVENUE IS NOT RENDERED AT ALL (owner, 2026-08-11: "remove ad
          revenue chart from the dashboard entirely rather than showing not
          available").

          It briefly had a placeholder card explaining its absence. The owner's
          call is the better one: a permanent "Not available" panel is a hole
          somebody has to read past on every visit, and a dashboard is judged by
          how fast it answers — an empty slot answers nothing.

          The reason it cannot exist is recorded HERE instead, where the next
          person to wonder "why is there no ad revenue chart" will look:
          AdSense and Monetag report earnings only in their own dashboards and
          never send them to us. Multiplying impressions by an assumed RPM would
          produce a confident, untraceable number in a screen decisions are made
          from. If earnings ever become available — an operator-entered monthly
          figure would be the honest route — this is where that panel goes.
        */}
      </AdminTabPanel>

      <AdminTabPanel id="ads" active={tab} className="grid gap-4 lg:grid-cols-2">
        <AdminAreaChart
          title="Ad impressions"
          subtitle={`${totalImpr.toLocaleString()} in the last ${range} days`}
          points={impressions}
          slot={1}
        />
        <AdminAreaChart
          title="Ad clicks"
          subtitle={ctr !== null ? `${totalClicks.toLocaleString()} clicks · ${ctr.toFixed(2)}% CTR` : undefined}
          points={clicks}
          slot={2}
        />
        {/* The figures an ad panel is actually read for, under the charts they
            come from — the same "line first, figures second" order the reward
            and install blocks already use. */}
        <div className="rounded-2xl border border-border/70 bg-secondary/25 p-4 lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="text-sm font-bold">Ad performance</p>
            <p className="text-xs text-muted-foreground">Last {range} days</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Impressions", value: totalImpr.toLocaleString() },
              { label: "Clicks", value: totalClicks.toLocaleString() },
              // "—" not "0%" when nothing was served: a CTR with no impressions
              // behind it is undefined, not zero.
              { label: "CTR", value: ctr === null ? "—" : `${ctr.toFixed(2)}%` },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-card px-3 py-3 text-center shadow-soft">
                <p className="text-2xl font-extrabold tabular-nums tracking-tight">{s.value}</p>
                <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Counted from this app&rsquo;s own impression and click records. Earnings are not shown
            because AdSense and Monetag report them only in their own dashboards — see the note in
            this file on why an assumed RPM is not an acceptable substitute.
          </p>
        </div>
      </AdminTabPanel>

      <AdminTabPanel id="visitors" active={tab} className="grid gap-4 lg:grid-cols-2">
        {visits.length > 0 ? (
          <AdminAreaChart
            title="Visitors"
            subtitle={`${visits.reduce((n, p) => n + p.value, 0).toLocaleString()} in the last ${range} days`}
            points={visits}
            slot={3}
          />
        ) : null}
        {/*
          New vs. returning, as two same-scale panels rather than one chart —
          this file's own rule is ONE axis, never two, and these two counts sum
          to a single day's active visitors, so they belong at the same scale
          slot ties them visually to "Visitors" above, since they're its split,
          not a new measure (owner, 2026-08-16: "make a chart for returning
          visitors and new visitors"). Capped at 30 days server-side — see
          getVisitorSplitSeries — so this stays flat/empty past that window.
        */}
        {newVisitors.length > 0 ? (
          <AdminAreaChart
            title="New visitors"
            subtitle={`${totalNewVisitors.toLocaleString()} first-time visitors, last ${newVisitors.length} days`}
            points={newVisitors}
            slot={3}
          />
        ) : null}
        {returningVisitors.length > 0 ? (
          <AdminAreaChart
            title="Returning visitors"
            subtitle={`${totalReturningVisitors.toLocaleString()} came back, last ${returningVisitors.length} days`}
            points={returningVisitors}
            slot={3}
          />
        ) : null}
        {/*
          🔴 SAYS "NOT MEASURED", NEVER DRAWS A FLAT ZERO LINE. Each chart above
          renders only when it has points, so before this tab existed their
          absence was invisible inside a longer page. On a tab of its own, all
          three missing would leave a blank panel that reads as a broken screen.

          The two reasons are genuinely different and are named separately: the
          analytics RPCs (migration 0115) not being present at all, versus a day
          the capped fallback scan could not cover (see getVisitorSplitSeries).
        */}
        {visits.length === 0 && newVisitors.length === 0 && returningVisitors.length === 0 ? (
          <p className="flex items-start gap-2 rounded-2xl border border-dashed border-border/70 p-5 text-xs text-muted-foreground lg:col-span-2">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No visitor series available for this window. That means it was not measured — not that
            nobody visited. Check that the analytics functions from migration 0115 are applied.
          </p>
        ) : null}
      </AdminTabPanel>

      <AdminTabPanel id="downloads" active={tab} className="grid gap-4 lg:grid-cols-2">
        {/*
          Downloads, counted from `analytics_downloads` where status = "completed"
          — the client-confirmed lifecycle table, not the legacy `downloads` table
          that logs every attempt as "completed" the instant it's requested (see
          the sourcing note in lib/monetization/revenue-series.ts). Owner,
          2026-08-16: "make a download chart in revenue just like visitors, ad
          clicks and impression chart in revenue."
        */}
        <AdminAreaChart
          title="Downloads"
          subtitle={`${totalDownloads.toLocaleString()} completed in the last ${range} days`}
          points={downloads}
          slot={4}
          className="lg:col-span-2"
        />
      </AdminTabPanel>

      <AdminTabPanel id="installs" active={tab} className="grid gap-4">
        {/*
          App installs — the same treatment downloads and visitors get (owner,
          2026-08-23). Counted from `pwa_installed`, the browser's own
          `appinstalled` event, so it is completed installs rather than taps on
          our Install button.

          `slot={3}`: the palette has four entries keyed to the MEASURE, and
          installs sit in the same "audience growth" family as the visitor
          charts rather than inventing a fifth colour the tokens do not define.
        */}
        <AdminAreaChart
          title="App installs"
          subtitle={`${installsMonth.toLocaleString()} in the last 30 days · Android & desktop only`}
          points={installs}
          slot={3}
        />

        {/*
          The three windows the owner asked for, read straight off the chart's own
          grid. Rendered UNDER the chart for the same reason the charts sit under
          the revenue tiles: the line answers "how did we get here", these answer
          "where are we now", and that is the order somebody reads them in.
        */}
        <div className="rounded-2xl border border-border/70 bg-secondary/25 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="text-sm font-bold">App installs</p>
            <p className="text-xs text-muted-foreground">Completed installs, trailing windows</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Today", value: installsToday },
              { label: "Last 7 days", value: installsWeek },
              { label: "Last 30 days", value: installsMonth },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-card px-3 py-3 text-center shadow-soft">
                <p className="text-2xl font-extrabold tabular-nums tracking-tight">
                  {s.value.toLocaleString()}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          {/*
            Stated on the panel, not buried in a comment: iOS fires no install
            event of any kind (Apple exposes nothing about Add to Home Screen), so
            this is an undercount rather than a total. An operator reading a
            dashboard deserves to know which way a number is wrong.
          */}
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Counted from the browser&rsquo;s own install event, so these are installs that
            finished — not taps on the Install button. iPhone and iPad report nothing when
            someone adds Frenz to their Home Screen, so real installs are higher than this.
          </p>
        </div>
      </AdminTabPanel>

      <AdminTabPanel id="rewards" active={tab} className="grid gap-4 lg:grid-cols-2">
        {/*
          Rewarded ads, as two charts rather than one (owner, 2026-08-23: "add
          reward ad activity in the revenue, the chart and information like how
          other revenue information there are").

          Started and completed are plotted separately, at their own honest
          scales, for the same reason this whole panel is a grid instead of one
          multi-line chart: the two series differ in magnitude, and overlaying
          them would need a second axis — the most misleading thing a chart can
          do. Read across the shared x-axis; the gap between the lines IS the
          drop-off.
        */}
        <AdminAreaChart
          title="Reward ads started"
          subtitle={`${totalRewardsStarted.toLocaleString()} opened in the last ${range} days`}
          points={rewardsStarted}
          slot={2}
        />
        <AdminAreaChart
          title="Reward ads completed"
          subtitle={
            rewardCompletion === null
              ? `${totalRewardsGranted.toLocaleString()} verified in the last ${range} days`
              : `${totalRewardsGranted.toLocaleString()} verified · ${rewardCompletion}% completion`
          }
          points={rewardsGranted}
          slot={1}
        />

        {/*
          Multi-Link batches (owner, 2026-08-25: "also a chart in revenue").

          Two lines for the same reason as the pair above: a success-only
          series makes a limit that is turning people away look like an
          absence of demand. `batch_started` is charted rather than
          `batch_authorized` because authorization happens BEFORE the ad and
          before the allowance is spent, so it would count batches nobody
          completed — this is "batches that actually ran", which is what
          corresponds to the impressions and downloads charted elsewhere.
        */}
        <AdminAreaChart
          title="Multi-Link batches"
          subtitle={`${totalMultilinkBatches.toLocaleString()} ran in the last ${range} days`}
          points={multilinkBatches}
          slot={2}
        />
        <AdminAreaChart
          title="Multi-Link refused"
          subtitle={
            totalMultilinkRefused === 0
              ? `None refused in the last ${range} days`
              : `${totalMultilinkRefused.toLocaleString()} hit a limit — unmet intent, and the upgrade case`
          }
          points={multilinkRefused}
          slot={1}
        />

      {/*
        The reward funnel in numbers, under the charts it summarises — the same
        "line first, figures second" order every other panel here uses.
      */}
      <div className="rounded-2xl border border-border/70 bg-secondary/25 p-4 lg:col-span-2">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="text-sm font-bold">Reward ads</p>
          <p className="text-xs text-muted-foreground">Last {range} days</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Started", value: totalRewardsStarted.toLocaleString() },
            { label: "Completed", value: totalRewardsGranted.toLocaleString() },
            // "—" not "0%" when nothing started: see the note on rewardCompletion.
            { label: "Completion", value: rewardCompletion === null ? "—" : `${rewardCompletion}%` },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-card px-3 py-3 text-center shadow-soft">
              <p className="text-2xl font-extrabold tabular-nums tracking-tight">{s.value}</p>
              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Counted server-side when a reward session is opened and again when one is verified — never
          from the ad player&rsquo;s own &ldquo;finished&rdquo; claim, which is exactly what the
          verification step exists to distrust. Revenue per reward isn&rsquo;t shown because no ad
          network reports earnings back to this system.
        </p>
      </div>
      </AdminTabPanel>
    </section>
  );
}

"use client";

import { Clock, Gift, Heart, Image as ImageIcon, Lock, Clapperboard, Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { TapPending } from "@/features/wallet/tap-pending";
import { coins, compact, type AnalyticsPeriod, PERIOD_CAPTION, pct, usd, WEEKDAYS, dayLabel } from "@/lib/creator-analytics/format";
import type { Overview } from "@/lib/creator-analytics/server";

import { Bars, LineChart, RollingNumber, Sparkline } from "../charts";
import { Blobs, Card, CardHead, CardSkeleton, Delta, Hero, PageHead, PeriodControl, Section, SectionTitle, Stat3, Tip, useAnalytics } from "../ui";

/*
  Screen 1 — Creator analytics overview (design/creator-analytics.html #overview).

  The hero shows the period's earnings in their OWN units side by side — subscriptions in US dollars, gifts in Gift
  Coins — because they are different money (the owner chose not to convert them at a guessed rate). The chart draws the
  two daily series, each scaled to its own peak, so their shape is comparable without pretending to share a unit.
  Every card links to its screen; the three main cards prefetch, everything else loads on tap (with the tap spinner).
*/

const scaleToPeak = (v: number[]) => {
  const m = Math.max(0, ...v);
  return m > 0 ? v.map((x) => (x / m) * 100) : v.map(() => 0);
};

export function OverviewScreen() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const q = useAnalytics<Overview>("overview", { period });
  return (
    <>
      <Blobs />
      <PageHead title="Creator analytics" sub="Your engagement, earnings and creations in one place.">
        <div className="mb-3.5 flex items-center justify-between gap-2.5 pt-3">
          <DiamondCrownBadge plan="business" size="sm" showLabel />
          <Link href="/account/creator-lounge" prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[var(--ca-blue)]">
            <TapPending size={14}>Open Creator Lounge ›</TapPending>
          </Link>
        </div>
      </PageHead>
      <PeriodControl value={period} onChange={setPeriod} periods={["7d", "30d", "90d", "1y"]} />

      <Section q={q} skeleton={<OverviewSkeleton />}>
        {(o) => <OverviewBody o={o} period={period} />}
      </Section>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <CardSkeleton hero lines={1} />
      <CardSkeleton />
      <CardSkeleton chart={false} />
      <CardSkeleton chart={false} />
    </>
  );
}

function OverviewBody({ o, period }: { o: Overview; period: AnalyticsPeriod }) {
  const e = o.earnings;
  const labels = o.earnings.series.length ? [dayLabel(e.series[0]!.day), dayLabel(e.series[Math.floor(e.series.length / 2)]!.day), dayLabel(e.series[e.series.length - 1]!.day)] : [];
  const anyMoney = (e.subscriptions?.cents ?? 0) > 0 || (e.gifts?.fgc ?? 0) > 0;
  return (
    <>
      <Hero background="var(--ca-hero-dark)" label={`Earnings, ${PERIOD_CAPTION[period].toLowerCase()}`}>
        <p className="text-sm font-semibold text-white/80">Earnings · {PERIOD_CAPTION[period]}</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[13px] text-white/75">
              <i aria-hidden className="h-2 w-2 rounded-full bg-[var(--ca-violet-light)]" />
              Subscriptions
            </div>
            {e.subscriptions ? (
              <>
                <RollingNumber value={e.subscriptions.cents} format={usd} className="mt-0.5 block text-[34px] font-extrabold tracking-[-1.2px]" />
                <Delta value={e.subscriptions.change} dark />
              </>
            ) : (
              <p className="mt-1 text-sm text-white/60">Not available yet</p>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[13px] text-white/75">
              <i aria-hidden className="h-2 w-2 rounded-full bg-[var(--ca-gold-bright)]" />
              Gifts
            </div>
            {e.gifts ? (
              <>
                <span className="mt-0.5 flex items-baseline gap-1.5">
                  <RollingNumber value={e.gifts.fgc} format={coins} className="text-[34px] font-extrabold tracking-[-1.2px]" />
                  <span className="text-[13px] font-semibold text-white/75">FGC</span>
                </span>
                <Delta value={e.gifts.change} dark />
              </>
            ) : (
              <p className="mt-1 text-sm text-white/60">Not available yet</p>
            )}
          </div>
        </div>
        {anyMoney ? (
          <LineChart
            dark
            className="mt-4"
            height={100}
            ariaLabel={`Daily earnings, ${PERIOD_CAPTION[period].toLowerCase()}: subscriptions ${usd(e.subscriptions?.cents ?? 0)}, gifts ${coins(e.gifts?.fgc ?? 0)} Gift Coins. Each line is scaled to its own peak.`}
            series={[
              { values: scaleToPeak(e.series.map((s) => s.cents)), stroke: "var(--ca-violet-light)", fill: "var(--ca-violet-light)" },
              { values: scaleToPeak(e.series.map((s) => s.fgc)), stroke: "var(--ca-gold-bright)", width: 2 },
            ]}
            labels={labels}
          />
        ) : (
          <p className="mt-4 text-[13px] text-white/70">No earnings in this period yet.</p>
        )}
      </Hero>

      <SectionTitle title="Main overview" aside={PERIOD_CAPTION[period]} />

      {o.social ? (
        <Card href="/account/analytics/social" prefetch label="Social engagement">
          <CardHead linked icon={<Heart className="h-5 w-5 text-[var(--ca-blue)]" />} iconBg="var(--ca-blue-soft)" title="Social engagement" caption="Views, followers and interactions" />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Big v={compact(o.social.views)} l="Views" />
            <Big v={compact(o.social.followers)} l="Followers" />
            <Big v={o.social.engagementRate === null ? "—" : pct(o.social.engagementRate)} l="Eng. rate" />
          </div>
          <div className="mt-3.5">
            <Sparkline values={o.social.spark} ariaLabel={`Views per day, ${PERIOD_CAPTION[period].toLowerCase()}: ${compact(o.social.views)} in total.`} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {o.social.newFollowers > 0 ? <Chip tone="up">+{o.social.newFollowers.toLocaleString("en-US")} followers</Chip> : null}
            {o.social.likesShare !== null ? <Chip>Likes {pct(o.social.likesShare)} of interactions</Chip> : null}
          </div>
        </Card>
      ) : null}

      {o.exclusive ? (
        <Card href="/account/analytics/exclusive" prefetch label="Exclusive post earnings">
          <CardHead linked icon={<Lock className="h-5 w-5 text-[var(--ca-violet)]" />} iconBg="var(--ca-violet-soft)" title="Exclusive post earnings" caption="From subscribers to your exclusive posts" />
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <RollingNumber value={o.exclusive.cents} format={usd} className="text-[30px] font-extrabold tracking-[-1px]" />
              <div className="mt-0.5 text-[13px] text-[var(--ca-sub)]">
                <Delta value={o.exclusive.change} suffix="vs last period" />
              </div>
            </div>
            <div className="w-[120px]">
              <Bars values={o.exclusive.weekly} height={56} gap={5} color="var(--ca-violet-soft)" highlight={o.exclusive.weekly.length - 1} activeColor="var(--ca-violet)" ariaLabel={`Weekly subscription earnings, last ${o.exclusive.weekly.length} weeks`} />
            </div>
          </div>
          <Stat3 items={[{ v: o.exclusive.newSubs.toLocaleString("en-US"), l: "New subscribers" }, { v: o.exclusive.posts ?? "—", l: "Exclusive posts" }, { v: o.exclusive.subscribeRate === null ? "—" : pct(o.exclusive.subscribeRate), l: "Subscribe rate" }]} />
        </Card>
      ) : null}

      {o.gifting ? (
        <Card href="/account/analytics/gifting" prefetch label="Gifting" className="!bg-none" style={{ background: "var(--ca-gold-card)", boxShadow: "0 8px 24px rgba(160,100,10,.10)" }}>
          <CardHead linked icon={<Gift className="h-5 w-5 text-[var(--ca-amber-ink)]" />} iconBg="#fff" title="Gifting" caption="Sticker gifts you received" captionColor="var(--ca-gold-sub)" chevronColor="var(--ca-gold-ink)" />
          <div className="mt-4 flex flex-wrap items-baseline gap-1.5">
            <RollingNumber value={o.gifting.fgc} format={coins} className="text-[30px] font-extrabold tracking-[-1px]" />
            <span className="text-sm font-semibold text-[var(--ca-gold-sub)]">Gift Coins</span>
            <Delta value={o.gifting.change} />
          </div>
          <Stat3 borderColor="rgba(138,75,6,.12)" items={[{ v: o.gifting.gifts.toLocaleString("en-US"), l: "Gifts" }, { v: o.gifting.supporters.toLocaleString("en-US"), l: "Supporters" }, { v: o.gifting.topSticker ?? "—", l: "Top sticker" }]} />
        </Card>
      ) : null}

      <SectionTitle title="More insights" />
      <div className="relative mx-4 mt-3 grid grid-cols-2 gap-3">
        <InsightTile href="/account/analytics/wallpapers" icon={<ImageIcon className="h-[19px] w-[19px] text-[var(--ca-sky-ink)]" />} iconBg="var(--ca-sky-soft)" title="Posts" v={o.posts ? compact(o.posts.downloads) : "—"} l={o.posts ? `Downloads · ${compact(o.posts.saves)} saves` : "Downloads"} />
        <InsightTile href="/account/analytics/ai" icon={<Clapperboard className="h-[19px] w-[19px] text-[var(--ca-magenta)]" />} iconBg="var(--ca-magenta-soft)" title="AI creations" v={o.ai ? compact(o.ai.created) : "—"} l={o.ai ? `Created · ${compact(o.ai.reposts)} reposts` : "Created"} />
      </div>

      <Link href="/account/analytics/feature" prefetch={false} className="relative mx-4 mt-3 flex min-h-11 items-center gap-3.5 rounded-[26px] p-[18px] text-white no-underline transition-transform active:scale-[0.98]" style={{ background: "var(--ca-brand)", boxShadow: "0 16px 34px rgba(91,60,230,.30), inset 0 1px 0 rgba(255,255,255,.3)" }}>
        <span aria-hidden className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-2xl border border-white/35 bg-white/20">
          <Trophy className="h-[26px] w-[26px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold tracking-[0.6px] text-white/85">FEATURE OF THE MONTH</span>
          <span className="mt-1 block text-xl font-extrabold tracking-[-0.4px]">{o.feature ? o.feature.name : "Not enough activity yet"}</span>
          <span className="mt-0.5 block text-[13px] text-white/90">{o.feature ? `Used by ${pct(o.feature.share)} of your audience this month` : "See how your audience uses Frenz"}</span>
        </span>
        <span className="text-white">
          <TapPending size={16}>›</TapPending>
        </span>
      </Link>

      {o.bestTime ? (
        <Tip
          href="/account/analytics/social/audience"
          icon={<Clock className="h-[18px] w-[18px] text-[var(--ca-blue)]" />}
          title={`Best time to post: ${WEEKDAYS[o.bestTime.dow]} ${BLOCK_RANGE[o.bestTime.block]}`}
          text={`${pct(o.bestTime.share)} of your views in the last 30 days came in this 4-hour window (your time).`}
        />
      ) : null}
    </>
  );
}

const BLOCK_RANGE: Record<number, string> = { 0: "12–4 AM", 1: "4–8 AM", 2: "8 AM–12 PM", 3: "12–4 PM", 4: "4–8 PM", 5: "8 PM–12 AM" };

function Big({ v, l }: { v: string; l: string }) {
  return (
    <div className="min-w-0">
      <div className="break-words text-[22px] font-extrabold tracking-[-0.6px]">{v}</div>
      <div className="text-[13px] text-[var(--ca-sub)]">{l}</div>
    </div>
  );
}

export function Chip({ children, tone }: { children: React.ReactNode; tone?: "up" }) {
  return <span className={tone === "up" ? "rounded-[9px] bg-[var(--ca-up-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--ca-up)]" : "rounded-[9px] bg-[var(--ca-chip)] px-2.5 py-1 text-xs font-semibold text-[#3B3D4A]"}>{children}</span>;
}

function InsightTile({ href, icon, iconBg, title, v, l }: { href: string; icon: React.ReactNode; iconBg: string; title: string; v: string; l: string }) {
  return (
    <Link href={href} prefetch={false} className="flex min-h-11 flex-col rounded-3xl border border-white bg-[var(--ca-glass)] p-4 text-[var(--ca-ink)] no-underline shadow-[0_6px_18px_rgba(16,18,40,.05)] transition-transform active:scale-[0.98]">
      <span className="flex items-start justify-between">
        <span aria-hidden className="flex h-[38px] w-[38px] items-center justify-center rounded-xl" style={{ background: iconBg }}>
          {icon}
        </span>
        <span className="text-[#9A9CA8]">
          <TapPending size={14}>{null}</TapPending>
        </span>
      </span>
      <span className="mt-3 text-[15px] font-bold">{title}</span>
      <span className="mt-2 break-words text-[26px] font-extrabold tracking-[-0.8px]">{v}</span>
      <span className="text-xs text-[var(--ca-sub)]">{l}</span>
    </Link>
  );
}

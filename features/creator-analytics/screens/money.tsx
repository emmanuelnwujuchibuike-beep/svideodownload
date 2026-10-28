"use client";

import { Lock, Repeat } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { TapPending } from "@/features/wallet/tap-pending";
import { coins, compact, type AnalyticsPeriod, PERIOD_CAPTION, pct, usd } from "@/lib/creator-analytics/format";
import type { Exclusive, Gifting } from "@/lib/creator-analytics/server";

import { Bars, RollingNumber } from "../charts";
import { BackLink, Blobs, Card, CardSkeleton, Delta, Empty, Hero, PageHead, PeriodControl, Section, Stat3, Tile, useAnalytics } from "../ui";

/*
  Screens 3 · 4 — Exclusive post earnings and Gifting (design/creator-analytics.html #exclusive #gifting).

  Exclusive posts on Frenz are SUBSCRIPTIONS (a member pays for a period and sees every exclusive post), not per-post
  unlocks, so this screen shows what really happens: subscription earnings in US dollars, new subscribers and
  renewals, and the funnel locked preview seen → Subscribe tapped → subscribed. Gifts are earned in Gift Coins (FGC):
  the creator's share of each gift, on hold until released (the Gift Box shows which).
*/

const PERIODS4 = ["7d", "30d", "90d", "1y"] as const;

export function ExclusiveScreen() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const q = useAnalytics<Exclusive>("exclusive", { period });
  return (
    <>
      <Blobs />
      <BackLink href="/account/analytics" label="Analytics" />
      <PageHead title="Exclusive post earnings" sub="What subscribers to your exclusive posts earned you." />
      <PeriodControl value={period} onChange={setPeriod} periods={PERIODS4} />
      <Section q={q} skeleton={<><CardSkeleton hero /><CardSkeleton chart={false} /></>}>
        {(x) =>
          x.newSubs + x.renewals === 0 && x.cents === 0 && (x.activeSubscribers ?? 0) === 0 ? (
            <Empty title="No subscribers yet" text="When members subscribe to your exclusive posts, your earnings show here." action={{ label: "Open your Exclusive dashboard", href: "/exclusive/dashboard" }} />
          ) : (
            <>
              <Hero background="var(--ca-hero-violet)" label={`Subscription earnings, ${PERIOD_CAPTION[period].toLowerCase()}`}>
                <p className="flex items-center gap-2 text-sm font-semibold text-white/80">
                  <Lock className="h-4 w-4" aria-hidden /> Earnings · {PERIOD_CAPTION[period]}
                </p>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                  <RollingNumber value={x.cents} format={usd} className="text-[44px] font-extrabold tracking-[-1.5px]" />
                  <Delta value={x.change} dark />
                </div>
                {x.weekly.length ? (
                  <div className="mt-4">
                    <Bars dark values={x.weekly} height={92} gap={8} color="rgba(255,255,255,.18)" activeColor="var(--ca-violet-light)" highlight={x.weekly.length - 1} labels={x.weekly.map((_, i) => (i === x.weekly.length - 1 ? "Now" : `W${i + 1}`))} ariaLabel={`Subscription earnings for each of the last ${x.weekly.length} weeks, this week last: ${x.weekly.map((c) => usd(c)).join(", ")}.`} />
                  </div>
                ) : null}
                <Stat3 dark items={[{ v: x.newSubs.toLocaleString("en-US"), l: "New subscribers" }, { v: x.renewals.toLocaleString("en-US"), l: "Renewals" }, { v: x.averageCents === null ? "—" : usd(x.averageCents), l: "Avg per payment" }]} />
              </Hero>

              <Card label="Subscribe funnel">
                <h2 className="m-0 text-[17px] font-bold">Subscribe funnel</h2>
                {x.funnel ? (
                  <Funnel
                    steps={[
                      { label: "Saw a locked preview", n: x.funnel.previewViewers },
                      { label: "Tapped Subscribe", n: x.funnel.tapped },
                      { label: "Subscribed", n: x.funnel.subscribed },
                    ]}
                    rateLabel="Subscribe rate"
                  />
                ) : (
                  <p className="mt-2 text-[13px] text-[var(--ca-sub)]">Preview views are recorded from now on — the funnel fills in as signed-in members see your locked posts.</p>
                )}
              </Card>

              <Card label="Top exclusive posts" className="!pb-2">
                <h2 className="m-0 mb-1 text-[17px] font-bold">Top exclusive posts</h2>
                {x.topPosts?.length ? (
                  x.topPosts.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 border-t border-[var(--ca-line)] py-2.5 first:border-t-0">
                      <span className="relative h-12 w-12 flex-none overflow-hidden rounded-[14px] bg-[var(--ca-violet-soft)]">
                        {/* eslint-disable-next-line @next/next/no-img-element -- the creator's own blurred preview */}
                        {p.thumb ? <img src={p.thumb} alt="" className="h-full w-full object-cover blur-[2px]" /> : null}
                        <Lock aria-hidden className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">#{i + 1} · {p.kind === "video" ? "Video" : "Photo"}</span>
                        <span className="mt-0.5 block text-[13px] text-[var(--ca-sub)]">Posted {new Date(p.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </span>
                      <span className="text-sm font-extrabold">{compact(p.views)} <span className="font-semibold text-[var(--ca-sub)]">views</span></span>
                    </div>
                  ))
                ) : (
                  <p className="py-3 text-[13px] text-[var(--ca-sub)]">No exclusive post was viewed in this period.</p>
                )}
              </Card>

              <div className="relative mx-4 mt-3 grid grid-cols-2 gap-3">
                <Tile v={x.repeatShare === null ? "—" : pct(x.repeatShare)} l="Repeat subscribers (renewals of all payments)">
                  <Repeat aria-hidden className="mt-2 h-4 w-4 text-[var(--ca-violet)]" />
                </Tile>
                <Tile v={x.activeSubscribers === null ? "—" : compact(x.activeSubscribers)} l="Active subscribers now" />
              </div>
            </>
          )
        }
      </Section>
    </>
  );
}

export function Funnel({ steps, rateLabel }: { steps: { label: string; n: number }[]; rateLabel: string }) {
  const top = Math.max(1, steps[0]?.n ?? 1);
  const last = steps[steps.length - 1]?.n ?? 0;
  return (
    <div className="mt-3" role="img" aria-label={`${steps.map((s) => `${s.label} ${s.n}`).join(", ")}. ${rateLabel} ${pct((last / top) * 100)}.`}>
      {steps.map((s, i) => (
        <div key={s.label} className="py-1.5">
          <div className="flex justify-between text-sm">
            <span>{s.label}</span>
            <b>{s.n.toLocaleString("en-US")}</b>
          </div>
          <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-[var(--ca-track)]">
            <i className="block h-full rounded-full" style={{ width: `${Math.max(s.n > 0 ? 3 : 0, (s.n / top) * 100)}%`, background: i === steps.length - 1 ? "var(--ca-brand-bar)" : "var(--ca-blue-tint)" }} />
          </div>
        </div>
      ))}
      <p className="mt-2 text-[13px] text-[var(--ca-sub)]">
        {rateLabel}: <b className="text-[var(--ca-ink)]">{pct((last / top) * 100)}</b>
      </p>
    </div>
  );
}

// ── 4 · Gifting ───────────────────────────────────────────────────────────────

export function GiftingScreen() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const q = useAnalytics<Gifting>("gifting", { period });
  return (
    <>
      <Blobs third="amber" />
      <BackLink href="/account/analytics" label="Analytics" />
      <PageHead title="Gifting" sub="Gift Coins from sticker gifts you received." />
      <PeriodControl value={period} onChange={setPeriod} periods={PERIODS4} />
      <Section q={q} skeleton={<><CardSkeleton hero /><CardSkeleton chart={false} /></>}>
        {(g) => (
          <>
            <Hero background="var(--ca-hero-gold)" glow="rgba(245,158,11,.4)" label={`Gift earnings, ${PERIOD_CAPTION[period].toLowerCase()}`}>
              <p className="text-sm font-semibold text-white/80">Gift Coins · {PERIOD_CAPTION[period]}</p>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                <RollingNumber value={g.fgc} format={coins} className="text-[44px] font-extrabold tracking-[-1.5px]" />
                <span className="text-[15px] font-semibold text-white/80">FGC</span>
                <Delta value={g.change} dark />
              </div>
              <p className="mt-0.5 text-[13px] text-white/75">
                From {g.gifts.toLocaleString("en-US")} gifts · {g.supporters.toLocaleString("en-US")} supporters
              </p>
              <div className="mt-4">
                <Bars dark values={g.monthly.map((m) => m.fgc)} height={92} gap={10} color="rgba(255,255,255,.18)" activeColor="var(--ca-gold-bright)" highlight={g.monthly.length - 1} labels={g.monthly.map((m) => new Date(`${m.month}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }))} ariaLabel={`Gift Coins earned per month, last 6 months: ${g.monthly.map((m) => coins(m.fgc)).join(", ")}.`} />
              </div>
            </Hero>

            {g.gifts === 0 ? (
              <Empty title="No gifts in this period" text="Sticker gifts people send you in chats show up here." />
            ) : (
              <>
                <Card label="By sticker" className="!pb-2">
                  <h2 className="m-0 mb-1 text-[17px] font-bold">By sticker</h2>
                  {g.bySticker.map((s) => (
                    <div key={s.name} className="flex items-center gap-3 border-t border-[var(--ca-line)] py-2.5 first:border-t-0">
                      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] bg-[#FFF4DB]">
                        {/* eslint-disable-next-line @next/next/no-img-element -- the sticker as it was when gifted (snapshot) */}
                        {s.imageUrl ? <img src={s.imageUrl} alt="" className="h-10 w-10 object-contain" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{s.name}</span>
                        <span className="mt-0.5 block text-[13px] text-[var(--ca-sub)]">{s.gifts.toLocaleString("en-US")} gifts</span>
                      </span>
                      <span className="text-sm font-extrabold text-[var(--ca-gold-ink)]">{coins(s.fgc)} FGC</span>
                    </div>
                  ))}
                </Card>
                <Card label="Top supporters" className="!pb-2">
                  <div className="flex items-baseline justify-between">
                    <h2 className="m-0 text-[17px] font-bold">Top supporters</h2>
                    <Link href="/wallet/gifts" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ca-blue)]">
                      <TapPending size={14}>View all gifts ›</TapPending>
                    </Link>
                  </div>
                  {g.topSupporters.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 border-t border-[var(--ca-line)] py-2.5 first:border-t-0">
                      <span className="w-5 text-center text-sm font-bold text-[var(--ca-sub)]">{i + 1}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a public avatar */}
                      {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-10 w-10 flex-none rounded-full object-cover" /> : <span aria-hidden className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[var(--ca-blue-soft)] text-sm font-bold text-[var(--ca-blue-ink)]">{p.name.replace("@", "").slice(0, 1).toUpperCase()}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{p.name}</span>
                        <span className="mt-0.5 block text-[13px] text-[var(--ca-sub)]">{p.gifts.toLocaleString("en-US")} gifts</span>
                      </span>
                      <span className="text-sm font-extrabold text-[var(--ca-gold-ink)]">{coins(p.fgc)} FGC</span>
                    </div>
                  ))}
                </Card>
              </>
            )}
          </>
        )}
      </Section>
    </>
  );
}

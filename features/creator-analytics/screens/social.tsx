"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BLOCKS, compact, type AnalyticsPeriod, dayLabel, PERIOD_CAPTION, pct, signed, SOURCE_LABEL, WEEKDAYS } from "@/lib/creator-analytics/format";
import type { Audience, Social, Views } from "@/lib/creator-analytics/server";

import { Bars, Heatmap, LineChart, Progress, RollingNumber, Sparkline, StackedBar } from "../charts";
import { BackLink, Blobs, Card, CardSkeleton, Chevron, Delta, PageHead, PeriodControl, Section, Tile, Tip, useAnalytics } from "../ui";

/* Screens 2 · 2a · 2b — Social engagement, Views, Audience (design/creator-analytics.html #social #views #audience). */

const PERIODS3 = ["7d", "30d", "90d"] as const;
const MIX_COLORS = { likes: "var(--ca-blue)", saves: "var(--ca-violet)", comments: "var(--ca-sky)", shares: "var(--ca-amber)", reposts: "var(--ca-magenta)" };

export function postInsightsHref(id: string) {
  return `/account/analytics/wallpapers/${id}`;
}

// ── 2 · Social engagement ─────────────────────────────────────────────────────

export function SocialScreen() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const q = useAnalytics<Social>("social", { period });
  return (
    <>
      <Blobs />
      <BackLink href="/account/analytics" label="Analytics" />
      <PageHead title="Social engagement" sub="How people interact with your posts." />
      <PeriodControl value={period} onChange={setPeriod} periods={PERIODS3} />
      <Section q={q} skeleton={<><CardSkeleton /><CardSkeleton chart={false} /></>}>
        {(s) => (
          <>
            <Card className="!rounded-[28px] !pt-5">
              <p className="text-sm font-semibold text-[var(--ca-sub)]">Engagement rate</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <RollingNumber value={s.engagementRate ?? 0} format={(v) => (s.engagementRate === null ? "—" : pct(v))} className="text-[44px] font-extrabold tracking-[-1.5px]" />
                <Delta value={s.rateChange} unit=" pts" />
              </div>
              <p className="mt-0.5 text-[13px] text-[var(--ca-sub)]">
                {compact(s.interactions)} interactions on {compact(s.views)} views
              </p>
              <LineChart className="mt-3.5" height={110} series={[{ values: s.rateSeries, stroke: "var(--ca-blue)", fill: "var(--ca-blue)" }]} ariaLabel={`Engagement rate per day, ${PERIOD_CAPTION[period].toLowerCase()}: ${s.engagementRate === null ? "no views yet" : pct(s.engagementRate)}.`} scrub={(i) => pct(s.rateSeries[i] ?? 0)} />
            </Card>
            <div className="relative mx-4 mt-3 grid grid-cols-3 gap-2.5">
              {(["likes", "comments", "shares"] as const).map((k) => (
                <Tile key={k} v={compact(s[k].n)} l={k === "shares" ? "Shares & reposts" : k[0]!.toUpperCase() + k.slice(1)} d={s[k].change === null ? undefined : <ChangeText v={s[k].change} />} />
              ))}
            </div>
            <div className="relative mx-4 mt-3 grid grid-cols-2 gap-3">
              <LinkTile href="/account/analytics/social/views" title="Views" v={compact(s.views)} spark={s.viewsSpark} />
              <LinkTile href="/account/analytics/social/audience" title="Followers" v={`+${compact(s.newFollowers)}`} spark={s.followersSpark} stroke="var(--ca-violet)" />
            </div>
            <Card label="Interaction mix">
              <h2 className="m-0 text-[17px] font-bold">Interaction mix</h2>
              <div className="mt-4">
                <StackedBar
                  ariaLabel={`Interaction mix: ${Object.entries(s.mix).map(([k, v]) => `${k} ${v}`).join(", ")}`}
                  parts={(Object.keys(s.mix) as (keyof typeof s.mix)[]).map((k) => ({ label: k[0]!.toUpperCase() + k.slice(1), value: s.mix[k], color: MIX_COLORS[k] }))}
                  format={(_, share) => pct(share)}
                />
              </div>
            </Card>
            <Card label="Most engaging posts" className="!pb-2">
              <h2 className="m-0 mb-1 text-[17px] font-bold">Most engaging posts</h2>
              {s.topPosts && s.topPosts.length ? (
                s.topPosts.map((p) => (
                  <Link key={p.id} href={postInsightsHref(p.id)} prefetch={false} className="flex min-h-11 items-center gap-3 border-t border-[var(--ca-line)] py-2.5 text-[var(--ca-ink)] no-underline first:border-t-0">
                    <Thumb url={p.thumbnailUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{p.title}</span>
                      <span className="mt-0.5 block text-[13px] text-[var(--ca-sub)]">{compact(p.views)} views · {compact(p.interactions)} interactions</span>
                    </span>
                    <span className="rounded-[11px] bg-[var(--ca-blue-soft)] px-2.5 py-1.5 text-sm font-extrabold text-[var(--ca-blue-ink)]">{pct(p.rate)}</span>
                    <Chevron />
                  </Link>
                ))
              ) : (
                <p className="py-3 text-[13px] text-[var(--ca-sub)]">No interactions on your posts in this period yet.</p>
              )}
            </Card>
          </>
        )}
      </Section>
    </>
  );
}

function ChangeText({ v }: { v: number | null }) {
  if (v === null) return null;
  const cls = v > 0.05 ? "text-[var(--ca-up)]" : v < -0.05 ? "text-[var(--ca-down)]" : "text-[var(--ca-sub)]";
  return <span className={cls}>{v > 0.05 ? "▲ " : v < -0.05 ? "▼ " : ""}{signed(v)}</span>;
}

function LinkTile({ href, title, v, spark, stroke = "var(--ca-blue)" }: { href: string; title: string; v: string; spark: number[]; stroke?: string }) {
  return (
    <Link href={href} prefetch={false} className="flex min-h-11 flex-col rounded-3xl border border-white bg-[var(--ca-glass)] p-4 text-[var(--ca-ink)] no-underline shadow-[0_6px_18px_rgba(16,18,40,.05)] transition-transform active:scale-[0.98]">
      <span className="flex items-center justify-between text-sm font-semibold text-[var(--ca-sub)]">
        {title}
        <Chevron />
      </span>
      <span className="mt-1.5 text-[26px] font-extrabold tracking-[-0.8px]">{v}</span>
      <span className="mt-2">
        <Sparkline values={spark} stroke={stroke} height={36} ariaLabel={`${title} trend`} />
      </span>
    </Link>
  );
}

export function Thumb({ url, tall }: { url: string | null; tall?: boolean }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- the creator's own post thumbnail
    <img src={url} alt="" loading="lazy" className={tall ? "h-[72px] w-14 flex-none rounded-2xl object-cover" : "h-12 w-12 flex-none rounded-[14px] object-cover"} />
  ) : (
    <span aria-hidden className={tall ? "h-[72px] w-14 flex-none rounded-2xl bg-[var(--ca-blue-soft)]" : "h-12 w-12 flex-none rounded-[14px] bg-[var(--ca-blue-soft)]"} />
  );
}

// ── 2a · Views ────────────────────────────────────────────────────────────────

const SOURCE_COLORS = ["var(--ca-blue)", "var(--ca-violet)", "var(--ca-sky)", "var(--ca-amber)", "var(--ca-magenta)", "var(--ca-muted)"];

export function ViewsScreen() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const q = useAnalytics<Views>("views", { period });
  return (
    <>
      <Blobs />
      <BackLink href="/account/analytics/social" label="Social" />
      <PageHead title="Views" sub="How often your posts were seen." />
      <PeriodControl value={period} onChange={setPeriod} periods={PERIODS3} />
      <Section q={q} skeleton={<><CardSkeleton /><CardSkeleton chart={false} /></>}>
        {(v) => <ViewsBody v={v} period={period} />}
      </Section>
    </>
  );
}

function ViewsBody({ v, period }: { v: Views; period: AnalyticsPeriod }) {
  const peakIndex = useMemo(() => v.bars.reduce((b, x, i, a) => (x.views > (a[b]?.views ?? -1) ? i : b), 0), [v.bars]);
  const [sel, setSel] = useState<number | null>(null);
  const selected = sel !== null && sel < v.bars.length ? sel : peakIndex;
  const bar = v.bars[selected];
  const sources = (v.sources ?? []).slice(0, 6);
  const srcTotal = sources.reduce((s, x) => s + x.count, 0);
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-baseline gap-2">
          <RollingNumber value={v.total} format={compact} className="text-[44px] font-extrabold tracking-[-1.5px]" />
          <span className="text-[15px] font-semibold text-[var(--ca-sub)]">views</span>
          <Delta value={v.change} />
        </div>
        <div className="mt-3">
          <Bars
            values={v.bars.map((b) => b.views)}
            height={170}
            gap={v.bars.length > 20 ? 2 : 5}
            highlight={selected}
            onSelect={setSel}
            barLabel={(i) => `${v.per === "week" ? "Week of " : ""}${dayLabel(v.bars[i]!.day)}: ${v.bars[i]!.views} views`}
            ariaLabel={`Views, ${PERIOD_CAPTION[period].toLowerCase()}: ${compact(v.total)}${v.change !== null ? `, ${v.change >= 0 ? "up" : "down"} ${pct(Math.abs(v.change))}` : ""}.${v.peak ? ` Peak ${dayLabel(v.peak.day)}.` : ""}`}
          />
        </div>
        {bar ? (
          <div aria-live="polite" className="mt-4 flex h-11 items-center gap-2.5 rounded-[14px] bg-[#F4F6FB] px-3 text-sm">
            <i aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--ca-blue)]" />
            <b>{v.per === "week" ? `Week of ${dayLabel(bar.day)}` : dayLabel(bar.day)}</b>
            <span className="text-[var(--ca-sub)]">· {bar.views.toLocaleString("en-US")} views</span>
          </div>
        ) : null}
      </Card>
      <div className="relative mx-4 mt-3 grid grid-cols-3 gap-2.5">
        <Tile v={compact(Math.round(v.average))} l={v.per === "week" ? "Avg per week" : "Avg per day"} />
        <Tile v={v.peak ? compact(v.peak.views) : "—"} l={v.peak ? `Peak · ${dayLabel(v.peak.day)}` : "Peak day"} />
        <Tile v={v.unique === null ? "—" : compact(v.unique)} l="Unique viewers" />
      </div>
      <Card label="Where views come from">
        <h2 className="m-0 text-[17px] font-bold">Where views come from</h2>
        {srcTotal > 0 ? (
          <>
            <div className="mt-4">
              <StackedBar legend={false} ariaLabel={`Views by source: ${sources.map((s) => `${SOURCE_LABEL[s.source] ?? s.source} ${s.count}`).join(", ")}`} parts={sources.map((s, i) => ({ label: SOURCE_LABEL[s.source] ?? s.source, value: s.count, color: SOURCE_COLORS[i]! }))} />
            </div>
            <ul className="mt-2">
              {sources.map((s, i) => (
                <li key={s.source} className="flex items-center gap-2.5 border-t border-[var(--ca-line)] py-2.5 text-sm first:border-t-0">
                  <i aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SOURCE_COLORS[i] }} />
                  <span className="flex-1">{SOURCE_LABEL[s.source] ?? s.source}</span>
                  <b>{compact(s.count)}</b>
                  <span className="w-12 text-right text-[var(--ca-sub)]">{pct((s.count / srcTotal) * 100)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-[13px] text-[var(--ca-sub)]">No views in this period yet.</p>
        )}
      </Card>
      <Tip href="/account/analytics/social/audience" icon={<Users className="h-[18px] w-[18px] text-[var(--ca-blue)]" />} title="Who's watching?" text="See your followers, where they are and when they're most active." />
    </>
  );
}

// ── 2b · Audience ─────────────────────────────────────────────────────────────

export function AudienceScreen() {
  const q = useAnalytics<Audience>("audience", {});
  const [where, setWhere] = useState<"countries" | "cities">("countries");
  return (
    <>
      <Blobs />
      <BackLink href="/account/analytics/social" label="Social" />
      <PageHead title="Audience" sub="Who follows you and when they are active." />
      <Section q={q} skeleton={<><CardSkeleton /><CardSkeleton chart={false} /><CardSkeleton /></>}>
        {(a) => (
          <>
            <Card className="!mt-4">
              <p className="text-sm font-semibold text-[var(--ca-sub)]">Followers</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <RollingNumber value={a.followers ?? 0} format={compact} className="text-[44px] font-extrabold tracking-[-1.5px]" />
                {a.newThisMonth > 0 ? <span className="rounded-xl bg-[var(--ca-up-bg)] px-2.5 py-1 text-[13px] font-bold text-[var(--ca-up)]">+{a.newThisMonth.toLocaleString("en-US")} this month</span> : null}
              </div>
              <LineChart className="mt-3.5" height={96} series={[{ values: a.growth, stroke: "var(--ca-violet)", fill: "var(--ca-violet)" }]} ariaLabel={`Followers over the last 30 days: now ${compact(a.followers)}, ${a.newThisMonth} new.`} scrub={(i) => compact(a.growth[i] ?? 0)} />
              <div className="mt-4 grid grid-cols-3 border-t border-[var(--ca-line)] pt-3.5">
                <div><div className="text-lg font-bold">+{a.newThisMonth.toLocaleString("en-US")}</div><div className="text-xs text-[var(--ca-sub)]">New</div></div>
                <div className="border-l border-[var(--ca-line)] pl-3.5"><div className="text-lg font-bold">{a.unfollowed > 0 ? `−${a.unfollowed.toLocaleString("en-US")}` : "0"}</div><div className="text-xs text-[var(--ca-sub)]">Unfollowed</div></div>
                <div className="border-l border-[var(--ca-line)] pl-3.5"><div className="text-lg font-bold">{a.followingShare === null ? "—" : pct(a.followingShare)}</div><div className="text-xs text-[var(--ca-sub)]">Viewers who follow</div></div>
              </div>
            </Card>

            <Card label="Top locations">
              <div className="flex items-center justify-between gap-2">
                <h2 className="m-0 text-[17px] font-bold">Top locations</h2>
                <div role="tablist" aria-label="Locations by" className="flex rounded-xl bg-[var(--ca-chip)] p-[3px]">
                  {(["countries", "cities"] as const).map((w) => (
                    <button key={w} type="button" role="tab" aria-selected={where === w} onClick={() => setWhere(w)} className={where === w ? "h-[30px] rounded-[9px] bg-white px-3 text-[13px] font-semibold shadow-sm" : "h-[30px] rounded-[9px] px-3 text-[13px] font-semibold text-[var(--ca-sub)]"}>
                      {w === "countries" ? "Countries" : "Cities"}
                    </button>
                  ))}
                </div>
              </div>
              <Locations rows={a.locations?.[where] ?? []} kind={where} />
            </Card>

            <Card label="Most active times">
              <h2 className="m-0 text-[17px] font-bold">Most active times</h2>
              <p className="mt-0.5 text-[13px] text-[var(--ca-sub)]">When your posts were viewed, last 30 days (your time)</p>
              {a.heatmap && a.heatmap.flat().some((x) => x > 0) ? (
                <Heatmap grid={a.heatmap} rows={WEEKDAYS} cols={BLOCKS} ariaLabel={`Views by day and time, last 30 days. Busiest: ${busiest(a.heatmap)}.`} />
              ) : (
                <p className="mt-3 text-[13px] text-[var(--ca-sub)]">Not enough views yet to show when your audience is active.</p>
              )}
            </Card>
          </>
        )}
      </Section>
    </>
  );
}

function busiest(grid: number[][]): string {
  let best = { d: 0, b: 0, v: -1 };
  grid.forEach((row, d) => row.forEach((v, b) => { if (v > best.v) best = { d, b, v }; }));
  return `${WEEKDAYS[best.d]} ${BLOCKS[best.b]}`;
}

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function Locations({ rows, kind }: { rows: { name: string; count: number }[]; kind: "countries" | "cities" }) {
  if (!rows.length) return <p className="mt-3 text-[13px] text-[var(--ca-sub)]">Locations are recorded for views from now on — they&apos;ll appear here as your posts are viewed.</p>;
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <ul className="mt-2">
      {rows.slice(0, 6).map((r) => (
        <li key={r.name} className="py-2">
          <div className="flex justify-between text-sm">
            <span className="font-semibold">{kind === "countries" ? regionName(r.name) : r.name}</span>
            <span className="text-[var(--ca-sub)]">{pct((r.count / total) * 100)}</span>
          </div>
          <Progress share={(r.count / rows[0]!.count) * 100} />
        </li>
      ))}
    </ul>
  );
}


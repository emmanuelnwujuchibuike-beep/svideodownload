"use client";

import { Bookmark, Download, Eye, Search, Share2, Clapperboard, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Spinner, TapPending } from "@/features/wallet/tap-pending";
import { coins, compact, type AnalyticsPeriod, PERIOD_CAPTION, pct } from "@/lib/creator-analytics/format";
import type { AICreations, FeatureMonth, PostInsights, PostsPage, PostSort } from "@/lib/creator-analytics/server";

import { Bars, LineChart, Progress, RollingNumber } from "../charts";
import { BackLink, Blobs, Card, CardSkeleton, Chevron, Delta, Empty, PageHead, PeriodControl, Section, Tile, Tip, useAnalytics } from "../ui";
import { Funnel } from "./money";
import { postInsightsHref, Thumb } from "./social";

/*
  Screens 5 · 5a · 6 · 7 — Posts ("Wallpaper engagement" in the design: the creator's published posts and their
  views, downloads and saves), one post's insights, AI creations and Feature of the month.
*/

// ── 5 · Posts ─────────────────────────────────────────────────────────────────

const SORTS: { key: PostSort; label: string }[] = [
  { key: "views", label: "Most viewed" },
  { key: "downloads", label: "Downloads" },
  { key: "saves", label: "Saves" },
  { key: "newest", label: "Newest" },
];

export function PostsScreen() {
  const [sort, setSort] = useState<PostSort>("views");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pages, setPages] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPages(1), [sort, debounced]);
  const first = useAnalytics<PostsPage>("posts", { sort, q: debounced, page: 0 });
  return (
    <>
      <Blobs third="sky" />
      <BackLink href="/account/analytics" label="Analytics" />
      <PageHead title="Posts" sub={first.data ? `${compact(first.data.totals.posts)} posts · ${compact(first.data.totals.downloads)} downloads · ${compact(first.data.totals.saves)} saves` : "Your posts, their views, downloads and saves."} />
      <label className="relative mx-4 mt-4 flex h-11 items-center gap-2 rounded-[14px] border border-white bg-white/75 px-3.5 shadow-[0_4px_14px_rgba(16,18,40,.05)]">
        <Search aria-hidden className="h-[18px] w-[18px] text-[var(--ca-muted)]" />
        <span className="sr-only">Search your posts</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your posts" className="min-w-0 flex-1 bg-transparent text-base outline-none" />
        {first.isValidating && debounced ? <Spinner size={14} /> : null}
      </label>
      <div role="tablist" aria-label="Sort by" className="relative flex gap-2 overflow-x-auto px-4 pt-3.5 [scrollbar-width:none]">
        {SORTS.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={sort === s.key} onClick={() => setSort(s.key)} className={sort === s.key ? "h-9 min-h-11 flex-none rounded-[18px] bg-[var(--ca-ink)] px-3.5 text-sm font-semibold text-white" : "h-9 min-h-11 flex-none rounded-[18px] border border-white bg-white/75 px-3.5 text-sm font-semibold text-[#3B3D4A]"}>
            {s.label}
          </button>
        ))}
      </div>
      <Section q={first} skeleton={<CardSkeleton chart={false} lines={4} />}>
        {(p) =>
          p.items.length === 0 ? (
            <Empty title={debounced ? "No posts match that search" : "No posts yet"} text={debounced ? undefined : "Publish a post to see how it performs."} />
          ) : (
            <div className="ca-glass relative mx-4 mt-3 overflow-hidden rounded-[26px]">
              <PostRows items={p.items} sort={sort} />
              {Array.from({ length: pages - 1 }, (_, i) => (
                <MorePosts key={i + 1} sort={sort} q={debounced} page={i + 1} />
              ))}
              {(pages === 1 ? p.next : null) !== null || pages > 1 ? <ShowMore sort={sort} q={debounced} pages={pages} onMore={() => setPages((n) => n + 1)} firstNext={p.next} /> : null}
            </div>
          )
        }
      </Section>
    </>
  );
}

function PostRows({ items, sort }: { items: PostsPage["items"]; sort: PostSort }) {
  return (
    <>
      {items.map((it) => (
        <Link key={it.id} href={postInsightsHref(it.id)} prefetch={false} className="flex min-h-11 items-center gap-3 border-b border-[var(--ca-line)] px-3.5 py-3 text-[var(--ca-ink)] no-underline">
          <Thumb url={it.thumbnailUrl} tall />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{it.title}</span>
            <span className="mt-0.5 block text-[13px] text-[var(--ca-sub)]">{new Date(it.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
            <span className="mt-1.5 flex gap-3 text-[13px] text-[#3B3D4A]">
              <span className="inline-flex items-center gap-1"><Eye aria-hidden className="h-3.5 w-3.5" />{compact(it.views)}<span className="sr-only"> views</span></span>
              <span className="inline-flex items-center gap-1"><Download aria-hidden className="h-3.5 w-3.5" />{compact(it.downloads)}<span className="sr-only"> downloads</span></span>
              <span className="inline-flex items-center gap-1"><Bookmark aria-hidden className="h-3.5 w-3.5" />{compact(it.saves)}<span className="sr-only"> saves</span></span>
            </span>
          </span>
          {sort !== "newest" ? <span className="min-w-12 flex-none rounded-xl bg-[var(--ca-blue-soft)] px-2 py-1.5 text-center text-sm font-extrabold text-[var(--ca-blue-ink)]">{compact(it[sort])}</span> : null}
          <Chevron />
        </Link>
      ))}
    </>
  );
}

function MorePosts({ sort, q, page }: { sort: PostSort; q: string; page: number }) {
  const r = useAnalytics<PostsPage>("posts", { sort, q, page });
  return r.data ? <PostRows items={r.data.items} sort={sort} /> : r.error ? <p className="p-4 text-[13px] text-[var(--ca-down)]">Couldn&apos;t load more.</p> : <div className="p-4"><Spinner size={18} /></div>;
}

/** "Show more" — reads whether the LAST loaded page has a next one (cached, so this costs nothing). */
function ShowMore({ sort, q, pages, onMore, firstNext }: { sort: PostSort; q: string; pages: number; onMore: () => void; firstNext: number | null }) {
  const last = useAnalytics<PostsPage>("posts", { sort, q, page: pages - 1 }, pages > 1);
  const next = pages === 1 ? firstNext : (last.data?.next ?? null);
  const loading = pages > 1 && !last.data;
  if (!loading && next === null) return null;
  return (
    <button type="button" disabled={loading} aria-busy={loading} onClick={onMore} className="flex h-12 w-full items-center justify-center gap-2 text-sm font-semibold text-[var(--ca-blue)] disabled:opacity-60">
      {loading ? <Spinner size={16} /> : null}
      Show more
    </button>
  );
}

// ── 5a · One post ─────────────────────────────────────────────────────────────

export function PostInsightsScreen({ id }: { id: string }) {
  const q = useAnalytics<PostInsights>("post", { id });
  return (
    <>
      <Blobs third="sky" />
      <BackLink href="/account/analytics/wallpapers" label="Posts" />
      <Section q={q} skeleton={<><CardSkeleton /><CardSkeleton chart={false} /></>}>
        {(p) => (
          <>
            <Card className="!mt-2 flex gap-4">
              <span className="relative flex-none">
                <Thumb url={p.thumbnailUrl} tall />
                {p.rank ? <span className="absolute -left-1.5 -top-1.5 rounded-full bg-[var(--ca-ink)] px-2 py-0.5 text-[11px] font-bold text-white">#{p.rank}</span> : null}
              </span>
              <span className="min-w-0 flex-1">
                <h1 className="m-0 break-words text-xl font-extrabold tracking-[-0.5px]">{p.title}</h1>
                <span className="mt-0.5 block text-[13px] text-[var(--ca-sub)]">Published {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                <span className="mt-3 flex gap-2">
                  <Link href={p.slugPath} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[var(--ca-ink)] px-4 text-sm font-semibold text-white">
                    <TapPending size={14}>View post</TapPending>
                  </Link>
                  <ShareButton path={p.slugPath} title={p.title} />
                </span>
              </span>
            </Card>
            {p.vsAverage !== null && p.vsAverage > 0 ? (
              <div className="relative mx-4 mt-3 rounded-[20px] px-4 py-3 text-sm font-semibold text-white" style={{ background: "var(--ca-brand)" }}>
                {p.vsAverage >= 1 ? `${p.vsAverage.toFixed(1)}× your average views` : `${Math.round(p.vsAverage * 100)}% of your average views`}
              </div>
            ) : null}
            <div className="relative mx-4 mt-3 grid grid-cols-3 gap-2.5">
              <Tile v={compact(p.metrics.views)} l="Views" />
              <Tile v={compact(p.metrics.downloads)} l="Downloads" />
              <Tile v={compact(p.metrics.saves)} l="Saves" />
              <Tile v={compact(p.metrics.shares)} l="Shares" />
              <Tile v={p.metrics.engagementRate === null ? "—" : pct(p.metrics.engagementRate)} l="Engagement" />
              <Tile v={p.metrics.avgWatchMs === null ? "—" : `${(p.metrics.avgWatchMs / 1000).toFixed(1)}s`} l="Avg view time" />
            </div>
            {p.curve.length > 1 ? (
              <Card label="Views since publishing">
                <h2 className="m-0 text-[17px] font-bold">Views since publishing</h2>
                <ul className="mt-2 flex gap-4 text-xs text-[var(--ca-sub)]">
                  <li className="flex items-center gap-1.5"><i aria-hidden className="inline-block h-0.5 w-4 bg-[var(--ca-blue)]" />This post</li>
                  <li className="flex items-center gap-1.5"><i aria-hidden className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[var(--ca-muted)]" />Your average</li>
                </ul>
                <LineChart
                  className="mt-3"
                  height={120}
                  series={[
                    { values: p.curve.map((c) => c.post), stroke: "var(--ca-blue)", fill: "var(--ca-blue)" },
                    { values: p.curve.map((c) => c.average), stroke: "var(--ca-muted)", dashed: true, width: 2 },
                  ]}
                  labels={["Day 0", `Day ${Math.floor((p.curve.length - 1) / 2)}`, `Day ${p.curve.length - 1}`]}
                  ariaLabel={`Views since publishing: ${compact(p.curve[p.curve.length - 1]!.post)} after ${p.curve.length - 1} days, against your average of ${compact(p.curve[p.curve.length - 1]!.average)}.`}
                  scrub={(i) => `Day ${i}: ${compact(p.curve[i]?.post ?? 0)}`}
                />
              </Card>
            ) : null}
            {p.funnel ? (
              <Card label="Download funnel">
                <h2 className="m-0 text-[17px] font-bold">Download funnel</h2>
                <Funnel steps={[{ label: "Viewed", n: p.funnel.viewed }, { label: "Opened the post page", n: p.funnel.opened }, { label: "Downloaded", n: p.funnel.downloaded }]} rateLabel="Download rate" />
                <p className="mt-1 text-xs text-[var(--ca-muted)]">Dated downloads are counted from the day this was added.</p>
              </Card>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}

function ShareButton({ path, title }: { path: string; title: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-busy={busy}
      onClick={async () => {
        const url = `${window.location.origin}${path}`;
        setBusy(true);
        try {
          if (navigator.share) await navigator.share({ title, url });
          else await navigator.clipboard.writeText(url);
        } catch {
          /* cancelled */
        }
        setBusy(false);
      }}
      className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--ca-line)] bg-white px-4 text-sm font-semibold"
    >
      {busy ? <Spinner size={14} /> : <Share2 aria-hidden className="h-4 w-4" />}
      Share
    </button>
  );
}

// ── 6 · AI creations ──────────────────────────────────────────────────────────

export function AIScreen() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const q = useAnalytics<AICreations>("ai", { period });
  return (
    <>
      <Blobs third="magenta" />
      <BackLink href="/account/analytics" label="Analytics" />
      <PageHead title="AI creations" sub="What you create with AI and how people respond." />
      <PeriodControl value={period} onChange={setPeriod} periods={["7d", "30d", "90d"]} />
      <Section q={q} skeleton={<><CardSkeleton /><CardSkeleton /></>}>
        {(a) =>
          a.created === 0 && a.published === 0 ? (
            <Empty title="No AI creations in this period" text="Make something with Frenz AI to see how it does." action={{ label: "Open Frenz AI", href: "/ai" }} />
          ) : (
            <>
              <div className="relative mx-4 mt-3.5 rounded-[26px] p-[1.5px]" style={{ background: "var(--ca-brand)" }}>
                <div className="grid grid-cols-2 gap-4 rounded-[25px] bg-white/95 p-[18px]">
                  <AIStat v={a.created} l="Created" d={a.createdChange} />
                  <AIStat v={a.published} l="Published" d={a.publishedChange} />
                  <AIStat v={a.reposts} l="Reposts by others" d={a.repostsChange} />
                  <div>
                    <div className="text-[26px] font-extrabold tracking-[-0.8px]">{a.viewShare === null ? "—" : pct(a.viewShare)}</div>
                    <div className="text-xs text-[var(--ca-sub)]">of your views</div>
                  </div>
                </div>
              </div>
              <Card label="Creations per week">
                <h2 className="m-0 text-[17px] font-bold">Creations per week</h2>
                <ul className="mt-2 flex gap-4 text-xs text-[var(--ca-sub)]">
                  <li className="flex items-center gap-1.5"><i aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-[var(--ca-magenta-soft)]" />Created</li>
                  <li className="flex items-center gap-1.5"><i aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-[var(--ca-magenta)]" />Published</li>
                </ul>
                <div className="relative mt-3">
                  <Bars values={a.weekly.map((w) => w.created)} height={110} color="var(--ca-magenta-soft)" ariaLabel={`AI creations per week, oldest first: ${a.weekly.map((w) => `${w.created} created, ${w.published} published`).join("; ")}.`} />
                  <div className="pointer-events-none absolute inset-0">
                    <Bars values={a.weekly.map((w) => w.published)} height={110} color="var(--ca-magenta)" ariaLabel="" />
                  </div>
                </div>
              </Card>
              {a.styles.length ? (
                <Card label="Your top styles">
                  <h2 className="m-0 text-[17px] font-bold">Your top styles</h2>
                  <ul className="mt-2">
                    {a.styles.map((s) => (
                      <li key={s.feature} className="py-2">
                        <div className="flex justify-between text-sm"><span className="font-semibold">{s.feature}</span><span className="text-[var(--ca-sub)]">{s.n}</span></div>
                        <Progress share={(s.n / a.styles[0]!.n) * 100} color="linear-gradient(90deg,var(--ca-magenta),var(--ca-violet))" />
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
              <Card label="Most reposted creations" className="!pb-2">
                <h2 className="m-0 mb-1 text-[17px] font-bold">Most reposted creations</h2>
                {a.mostReposted.length ? (
                  a.mostReposted.map((p) => (
                    <Link key={p.id} href={postInsightsHref(p.id)} prefetch={false} className="flex min-h-11 items-center gap-3 border-t border-[var(--ca-line)] py-2.5 text-[var(--ca-ink)] no-underline first:border-t-0">
                      <Thumb url={p.thumbnailUrl} />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.title}</span>
                      <span className="inline-flex items-center gap-1 rounded-[11px] bg-[var(--ca-magenta-soft)] px-2.5 py-1.5 text-sm font-extrabold text-[var(--ca-magenta-ink)]">{compact(p.reposts)}</span>
                      <Chevron />
                    </Link>
                  ))
                ) : (
                  <p className="py-3 text-[13px] text-[var(--ca-sub)]">None of your AI posts was reposted in this period.</p>
                )}
              </Card>
              {a.viewShare !== null && a.viewShare >= 20 && a.published > 0 ? (
                <Tip tone="magenta" icon={<Clapperboard className="h-[18px] w-[18px] text-[var(--ca-magenta)]" />} title="AI posts pull their weight" text={`${pct(a.viewShare)} of your views ${PERIOD_CAPTION[period].toLowerCase()} came from posts you made with AI.`} />
              ) : null}
            </>
          )
        }
      </Section>
    </>
  );
}

function AIStat({ v, l, d }: { v: number; l: string; d: number | null }) {
  return (
    <div>
      <RollingNumber value={v} format={compact} className="text-[26px] font-extrabold tracking-[-0.8px]" />
      <div className="text-xs text-[var(--ca-sub)]">{l}</div>
      <div className="mt-1"><Delta value={d} /></div>
    </div>
  );
}

// ── 7 · Feature of the month ──────────────────────────────────────────────────

const FEATURE_HREF: Record<string, string> = { sticker_gifts: "/account/analytics/gifting", exclusive: "/account/analytics/exclusive", ai_creation: "/account/analytics/ai", wallpapers: "/account/analytics/wallpapers" };
const monthName = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

export function FeatureScreen() {
  const q = useAnalytics<FeatureMonth>("feature", {});
  return (
    <>
      <Blobs third="magenta" />
      <BackLink href="/account/analytics" label="Analytics" />
      <PageHead title="Feature of the month" sub={q.data ? `The Frenz features your audience used most in ${monthName(q.data.month)}.` : "The Frenz features your audience used most."} />
      <Section q={q} skeleton={<><CardSkeleton hero /><CardSkeleton chart={false} lines={5} /></>}>
        {(f) =>
          !f.winner ? (
            <Empty title="Not enough activity yet" text="When your followers and viewers use Frenz features this month, the ranking shows here." />
          ) : (
            <>
              <section aria-label="This month's winner" className="relative mx-4 mt-4 overflow-hidden rounded-[28px] p-5 text-white" style={{ background: "var(--ca-brand)", boxShadow: "0 16px 34px rgba(91,60,230,.30)" }}>
                <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/35 bg-white/20"><Trophy className="h-6 w-6" /></span>
                <p className="mt-3 text-xs font-bold tracking-[0.6px] text-white/85">{monthName(f.month).toUpperCase()} WINNER</p>
                <h2 className="m-0 mt-1 text-[28px] font-extrabold tracking-[-0.6px]">{f.winner.name}</h2>
                <p className="mt-1 text-sm text-white/90">Used by {pct(f.winner.share)} of your audience of {compact(f.audience)} this month.</p>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/20 pt-3.5">
                  <div><div className="text-lg font-bold">{pct(f.winner.share)}</div><div className="text-xs text-white/75">of audience</div></div>
                  {f.giftsToCreator ? (
                    <>
                      <div className="border-l border-white/20 pl-3"><div className="text-lg font-bold">{f.giftsToCreator.gifts.toLocaleString("en-US")}</div><div className="text-xs text-white/75">gifts to you</div></div>
                      <div className="border-l border-white/20 pl-3"><div className="text-lg font-bold">{coins(f.giftsToCreator.fgc)}</div><div className="text-xs text-white/75">FGC earned</div></div>
                    </>
                  ) : (
                    <div className="col-span-2 border-l border-white/20 pl-3"><div className="text-lg font-bold">{compact(f.ranking[0]?.users ?? 0)}</div><div className="text-xs text-white/75">people used it</div></div>
                  )}
                </div>
                {FEATURE_HREF[f.winner.key] ? (
                  <Link href={FEATURE_HREF[f.winner.key]!} className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-[var(--ca-ink)]">
                    <TapPending size={14}>See {f.winner.name.toLowerCase()} details</TapPending>
                  </Link>
                ) : null}
              </section>
              <Card label="Feature ranking" className="!pb-2">
                <h2 className="m-0 mb-1 text-[17px] font-bold">Feature ranking</h2>
                {f.ranking.map((r, i) => (
                  <div key={r.key} className="border-t border-[var(--ca-line)] py-2.5 first:border-t-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-center font-bold text-[var(--ca-sub)]">{i + 1}</span>
                      <span className="flex-1 font-semibold">{r.name}</span>
                      <span className="text-[var(--ca-sub)]">{pct(r.share)}</span>
                      <RankChange v={r.rankChange} />
                    </div>
                    <div className="pl-7"><Progress share={r.share} /></div>
                  </div>
                ))}
              </Card>
              {f.pastWinners.length ? (
                <Card label="Past winners">
                  <h2 className="m-0 text-[17px] font-bold">Past winners</h2>
                  <ul className="mt-2">
                    {f.pastWinners.map((w) => (
                      <li key={w.month} className="flex items-center justify-between border-t border-[var(--ca-line)] py-2.5 text-sm first:border-t-0">
                        <span className="text-[var(--ca-sub)]">{monthName(w.month)}</span>
                        <span className="font-semibold">{w.name}</span>
                        <span className="text-[var(--ca-sub)]">{pct(w.share)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
              <Tip tone="violet" icon={<Trophy className="h-[18px] w-[18px] text-[var(--ca-violet)]" />} title="How this is measured" text="Your audience is everyone who follows you or viewed your posts this month. A feature counts when they did its own action this month — sent a gift, subscribed, made something with AI, shared, and so on." />
            </>
          )
        }
      </Section>
    </>
  );
}

function RankChange({ v }: { v: number | null }) {
  if (v === null) return <span className="w-9 text-right text-xs font-bold text-[var(--ca-muted)]" aria-label="new this month">new</span>;
  if (v > 0) return <span className="w-9 text-right text-xs font-bold text-[var(--ca-up)]" aria-label={`up ${v}`}>▲{v}</span>;
  if (v < 0) return <span className="w-9 text-right text-xs font-bold text-[var(--ca-down)]" aria-label={`down ${-v}`}>▼{-v}</span>;
  return <span className="w-9 text-right text-xs font-bold text-[var(--ca-muted)]" aria-label="no change">—</span>;
}

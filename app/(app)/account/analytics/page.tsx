import { BarChart3, Bookmark, Compass, Download, Eye, Gem, Heart, MessageCircle, Route, Share2, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { AppContent } from "@/features/app-shell/app-content";
import { getUserPlan } from "@/lib/monetization/plan";
import { getCreatorAnalytics } from "@/lib/social/creator-analytics";
import { getShareJourney, type ShareKind } from "@/lib/social/share/insights";
import { createClient } from "@/lib/supabase/server";
import { cn, formatCompactNumber } from "@/lib/utils";

const SHARE_KIND_LABEL: Record<ShareKind, string> = {
  dm: "Direct message",
  group: "Group chat",
  copy_link: "Copied link",
  os_share: "Share sheet",
  email: "Email",
  sms: "Text message",
  qr: "QR code",
};

/** Known post_watch_events.source values → readable labels. An unknown/new
 *  source string still renders (falls back to itself), so this never hides
 *  a real source, just leaves it unprettified until added here. */
const SOURCE_LABEL: Record<string, string> = {
  for_you: "For You",
  following: "Following",
  recent: "Recent",
  trending: "Trending",
  reels: "Reels",
  post_page: "Post page",
  search: "Search",
  profile: "Profile",
  collection: "Collection",
  untagged: "Other",
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creator analytics",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function CreatorAnalyticsPage() {
  if (!hasSupabase) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/analytics");

  const plan = await getUserPlan(user.id);

  return (
    <AppContent>
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
              Creator analytics
            </h1>
            <p className="mt-2 text-muted-foreground">Performance across your published downloads.</p>
            <Link href="/account/creator-lounge" className="mt-2 inline-block text-sm font-semibold text-primary hover:opacity-80">
              Open Creator Lounge →
            </Link>
          </div>
          <DiamondCrownBadge plan="business" size="md" showLabel />
        </header>

        {plan !== "business" ? (
          <Locked />
        ) : (
          <Analytics userId={user.id} />
        )}
      </div>
    </AppContent>
  );
}

function Locked() {
  return (
    <div className="rounded-3xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.06] to-transparent p-8 text-center">
      <Gem className="mx-auto h-10 w-10 text-amber-500" />
      <h2 className="mt-4 text-xl font-bold">Creator analytics is a Business feature</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Upgrade to Business to unlock per-post views, downloads, engagement rate, audience growth and
        your top-performing content.
      </p>
      <Link
        href="/pricing#business"
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition hover:shadow-amber-500/40"
      >
        <Gem className="h-4 w-4" /> Upgrade to Business
      </Link>
    </div>
  );
}

async function Analytics({ userId }: { userId: string }) {
  const [a, journey] = await Promise.all([getCreatorAnalytics(userId), getShareJourney(userId)]);

  if (a.totals.posts === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
        Publish a download to start seeing analytics here.
      </div>
    );
  }

  const breakdown = [
    { icon: Heart, label: "Likes", value: a.totals.likes, className: "from-red-500 to-rose-400" },
    { icon: Bookmark, label: "Saves", value: a.totals.saves, className: "from-blue-600 to-cyan-400" },
    { icon: Share2, label: "Shares", value: a.totals.shares, className: "from-violet-600 to-fuchsia-500" },
    { icon: MessageCircle, label: "Comments", value: a.totals.comments, className: "from-emerald-600 to-teal-400" },
  ];
  const maxEng = Math.max(1, ...breakdown.map((b) => b.value));
  const maxTop = Math.max(1, ...a.topPosts.map((p) => p.views));

  return (
    <div className="space-y-6">
      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={BarChart3} label="Posts" value={formatCompactNumber(a.totals.posts)} accent />
        <Stat icon={Eye} label="Total views" value={formatCompactNumber(a.totals.views)} />
        <Stat icon={Download} label="Downloads" value={formatCompactNumber(a.totals.downloads)} />
        <Stat icon={Users} label="Followers" value={formatCompactNumber(a.followers)} />
      </div>

      {/* Reach + engagement */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
          <h2 className="mb-4 text-sm font-semibold">Reach</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Mini label="Views 7d" value={formatCompactNumber(a.views7d)} />
            <Mini label="Views 30d" value={formatCompactNumber(a.views30d)} />
            <Mini label="Eng. rate" value={`${a.engagementRate}%`} accent />
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
          <h2 className="mb-4 text-sm font-semibold">Engagement</h2>
          <div className="space-y-3">
            {breakdown.map((b) => (
              <div key={b.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium">
                    <b.icon className="h-3.5 w-3.5 text-muted-foreground" /> {b.label}
                  </span>
                  <span className="text-muted-foreground">{formatCompactNumber(b.value)}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className={cn("h-full rounded-full bg-gradient-to-r", b.className)} style={{ width: `${Math.max(2, (b.value / maxEng) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Top posts */}
      <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
        <h2 className="mb-4 text-sm font-semibold">Top posts</h2>
        <ul className="space-y-3">
          {a.topPosts.map((p) => (
            <li key={p.id}>
              <Link href={`/p/${p.id}`} className="group flex items-center gap-3">
                {p.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnailUrl} alt="" loading="lazy" className="h-12 w-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="h-12 w-16 shrink-0 rounded-lg bg-secondary" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium group-hover:underline">{p.title}</span>
                  <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${Math.max(3, (p.views / maxTop) * 100)}%` }} />
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  <span className="block font-semibold text-foreground">{formatCompactNumber(p.views)}</span>
                  views
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Discovery Analytics (Feature 15 Part 8) — where reach actually came
          from and how deeply it was watched. Only renders sections with real
          data: an empty post_watch_events table (pre-migration, or simply no
          watches recorded yet) means no fabricated Traffic Sources/Retention
          rather than a chart full of zeros. */}
      {a.discovery.trafficSources.length > 0 || a.discovery.topicReach.length > 0 ? (
        <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Compass className="h-4 w-4 text-blue-500" /> Discovery
          </h2>
          <div className="mb-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
            <Mini label="Retention" value={a.discovery.retention > 0 ? `${a.discovery.retention}%` : "—"} accent />
            <Mini label="New followers 7d" value={formatCompactNumber(a.discovery.newFollowers7d)} />
            <Mini label="Topics reached" value={String(a.discovery.topicReach.length)} />
          </div>
          {a.discovery.trafficSources.length > 0 ? (
            <div className="space-y-2">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Traffic sources</p>
              {a.discovery.trafficSources.slice(0, 6).map((s) => (
                <div key={s.source} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">{SOURCE_LABEL[s.source] ?? s.source}</span>
                  <span className="font-semibold">{formatCompactNumber(s.count)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {a.discovery.topicReach.length > 0 ? (
            <div className="mt-4 space-y-2">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Topic reach</p>
              {a.discovery.topicReach.slice(0, 6).map((t) => (
                <div key={t.category} className="flex items-center justify-between text-xs">
                  <span className="font-medium capitalize text-muted-foreground">{t.category}</span>
                  <span className="font-semibold">{formatCompactNumber(t.views)} views</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Share Journey™ — a real funnel (sent → opened), not a propagation
          tree (see lib/social/share/insights.ts's own header on why). */}
      {journey.totalShares > 0 ? (
        <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Route className="h-4 w-4 text-violet-500" /> Share Journey™
          </h2>
          <div className="mb-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
            <Mini label="Total shares" value={formatCompactNumber(journey.totalShares)} accent />
            <Mini label="Reached recipients" value={formatCompactNumber(journey.addressableRecipients)} />
            <Mini label="Opened it" value={formatCompactNumber(journey.recipientsWhoOpened)} />
          </div>
          <div className="space-y-2">
            {(Object.entries(journey.byKind) as [ShareKind, number][])
              .sort((x, y) => y[1] - x[1])
              .map(([kind, count]) => (
                <div key={kind} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">{SHARE_KIND_LABEL[kind]}</span>
                  <span className="font-semibold">{formatCompactNumber(count)}</span>
                </div>
              ))}
          </div>
          {journey.addressableRecipients === 0 ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              &quot;Opened it&quot; only measures direct-message and group shares, where the recipient is actually known — copied
              links, email, SMS and QR shares have no addressable recipient to track.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }: { icon: typeof Eye; label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-5 shadow-soft", accent ? "border-primary/30 bg-primary/[0.03] ring-1 ring-primary/15" : "border-border/70 bg-card")}>
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", accent ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <p className="mt-4 text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-3", accent ? "border-primary/30 bg-primary/[0.05]" : "border-border/60 bg-secondary/20")}>
      <p className="text-lg font-bold tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

import { BarChart3, Bookmark, Download, Eye, Gem, Heart, MessageCircle, Share2, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getUserPlan } from "@/lib/monetization/plan";
import { getCreatorAnalytics } from "@/lib/social/creator-analytics";
import { createClient } from "@/lib/supabase/server";
import { cn, formatCompactNumber } from "@/lib/utils";

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
    <>
      <SiteHeader />
      <main className="container max-w-3xl pb-24 pt-28 sm:pt-36">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
              Creator analytics
            </h1>
            <p className="mt-2 text-muted-foreground">Performance across your published downloads.</p>
          </div>
          <DiamondCrownBadge plan="business" size="md" showLabel />
        </header>

        {plan !== "business" ? (
          <Locked />
        ) : (
          <Analytics userId={user.id} />
        )}
      </main>
      <SiteFooter />
    </>
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
  const a = await getCreatorAnalytics(userId);

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

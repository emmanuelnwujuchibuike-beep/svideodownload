import { Activity, Compass, Hash, Music, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CollaboratorPanel } from "@/features/studio/collaborator-panel";
import { RetentionChart } from "@/features/studio/retention-chart";
import { EmptyNote, MeterRow, Pill, StudioCard } from "@/features/studio/studio-ui";
import { listCollaborators } from "@/lib/creator/collab";
import { getPostInsights } from "@/lib/creator/post-insights";
import { createClient } from "@/lib/supabase/server";
import { formatCompactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Post performance" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  untagged: "Untagged",
};

/**
 * Per-post performance (Feature 15 · Part 9).
 *
 * Ownership is enforced by `getPostInsights` (it reads through
 * `getCreatorContentItem`, which matches `publisher_id`). Somebody else's post
 * returns null and this 404s — the same answer as "does not exist", so the page
 * never confirms a post's existence to a creator who does not own it.
 */
export default async function PostInsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/studio/content/${id}`);

  const insights = await getPostInsights(id, user.id);
  if (!insights) notFound();

  const { post, retention, trafficSources, reach, tagPerformance, sound, rankByViews, totalPosts } = insights;
  const reachTotal = reach.discovery + reach.followed + reach.other;
  const engagement = post.likes + post.comments + post.shares + post.saves;

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-4">
        {post.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.thumbnailUrl} alt="" className="h-20 w-28 shrink-0 rounded-2xl object-cover" />
        ) : (
          <span className="h-20 w-28 shrink-0 rounded-2xl bg-secondary" />
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-snug tracking-[-0.02em] sm:text-xl">{post.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {rankByViews !== null ? (
              <Pill tone={rankByViews === 1 ? "amber" : "muted"}>
                #{rankByViews} of your {totalPosts}
              </Pill>
            ) : null}
            {post.status !== "published" ? <Pill tone="rose">{post.status}</Pill> : null}
            <Link href={`/p/${post.id}`} prefetch={false} className="text-xs font-semibold text-primary hover:opacity-80">
              View post
            </Link>
            <Link href="/studio/content" prefetch className="text-xs font-semibold text-muted-foreground hover:text-foreground">
              Back to content
            </Link>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Views" value={post.views} />
        <Tile label="Engagements" value={engagement} />
        <Tile label="Downloads" value={post.downloads} />
        <Tile label="Comments" value={post.comments} />
      </div>

      <StudioCard title="Audience retention" icon={Activity} subtitle="How far into the video people got">
        <RetentionChart curve={retention} />
        {insights.sampleTruncated ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Based on the most recent 5,000 watches — this post has more.
          </p>
        ) : null}
      </StudioCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <StudioCard title="Traffic sources" icon={Compass} subtitle="The surface that served each watch">
          {trafficSources.length === 0 ? (
            <EmptyNote>No watch data yet.</EmptyNote>
          ) : (
            <div className="space-y-3">
              {trafficSources.slice(0, 7).map((s) => (
                <MeterRow
                  key={s.source}
                  label={SOURCE_LABEL[s.source] ?? s.source.replace(/_/g, " ")}
                  value={s.count}
                  max={trafficSources[0]!.count}
                  display={`${Math.round(s.share * 100)}%`}
                />
              ))}
            </div>
          )}
        </StudioCard>

        <StudioCard
          title="Reach"
          icon={TrendingUp}
          subtitle="Discovered by strangers, or seen by people who follow you"
        >
          {reachTotal === 0 ? (
            <EmptyNote>
              No watch data yet. Reach here is derived from the surface tag on each watch — there is no
              modelled &quot;estimated reach&quot; anywhere in this product.
            </EmptyNote>
          ) : (
            <div className="space-y-3">
              <MeterRow
                label="Discovery"
                value={reach.discovery}
                max={reachTotal}
                display={`${Math.round((reach.discovery / reachTotal) * 100)}%`}
                tone="from-violet-600 to-fuchsia-500"
              />
              <MeterRow
                label="Followers"
                value={reach.followed}
                max={reachTotal}
                display={`${Math.round((reach.followed / reachTotal) * 100)}%`}
                tone="from-emerald-600 to-teal-400"
              />
              {reach.other > 0 ? (
                <MeterRow
                  label="Other / untagged"
                  value={reach.other}
                  max={reachTotal}
                  display={`${Math.round((reach.other / reachTotal) * 100)}%`}
                  tone="from-slate-500 to-slate-400"
                />
              ) : null}
              <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                Community and friend reach are absent: there is no communities table in this product, and a
                watch records which surface served it, not the watcher&apos;s relationship to you.
              </p>
            </div>
          )}
        </StudioCard>
      </div>

      <StudioCard title="Hashtag performance" icon={Hash} subtitle="This post's tags against your own average">
        {tagPerformance.length === 0 ? (
          <EmptyNote>
            {post.tags.length === 0
              ? "This post has no hashtags. Add some from the content page — they are stored in the caption, which is what search reads."
              : "These tags only appear on this post, so there is nothing to average them against yet."}
          </EmptyNote>
        ) : (
          <ul className="space-y-2.5">
            {tagPerformance.map((t) => (
              <li key={t.tag} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-semibold text-primary/90">#{t.display}</span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  <span className="tabular-nums">{formatCompactNumber(Math.round(t.averageViews))} avg</span>
                  <span className="tabular-nums opacity-70">{t.posts} posts</span>
                  {t.vsAverage !== null ? (
                    <Pill tone={t.vsAverage >= 0 ? "emerald" : "rose"}>
                      {t.vsAverage >= 0 ? "+" : ""}
                      {Math.round(t.vsAverage * 100)}%
                    </Pill>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </StudioCard>

      {sound ? (
        <StudioCard title="Sound" icon={Music}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/sound/${sound.id}`} prefetch={false} className="block truncate text-sm font-semibold hover:underline">
                {sound.title}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{sound.artistLabel}</p>
            </div>
            <div className="shrink-0 text-right text-xs text-muted-foreground">
              <p className="font-semibold tabular-nums text-foreground">{formatCompactNumber(sound.plays)}</p>
              <p>plays · {sound.postsUsing} posts</p>
            </div>
          </div>
        </StudioCard>
      ) : null}

      <CollaboratorPanel postId={post.id} initial={await listCollaborators(post.id, user.id)} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-soft">
      <p className="text-xl font-bold tabular-nums">{formatCompactNumber(value)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

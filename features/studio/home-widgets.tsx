import {
  Bookmark,
  Eye,
  Heart,
  Lightbulb,
  MessageCircle,
  Share2,
  Sparkles,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";

import type { CreatorHealth } from "@/lib/creator/health";
import type { JourneyStep } from "@/lib/creator/journey";
import type { ContentSuggestion, CreatorHome } from "@/lib/creator/studio";
import { cn, formatCompactNumber } from "@/lib/utils";

import { EmptyNote, MeterRow, Pill, ProgressRing, StudioCard } from "./studio-ui";

/**
 * Creator Home widgets (Feature 15 · Part 9).
 *
 * Server components: each is a pure render of data the page already has. The
 * dashboard ships no JavaScript to draw itself, which is the difference between
 * a dashboard that opens instantly on a phone and one that hydrates for a
 * second first.
 */

function relativeDay(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WeeklyGoalWidget({ goal }: { goal: CreatorHome["goal"] }) {
  return (
    <StudioCard title="Weekly goal" icon={Target}>
      {goal.progress === null ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Set an upload target and this tracks it against what you actually publish each week.
            You&apos;ve published {goal.published} {goal.published === 1 ? "post" : "posts"} in the last 7 days.
          </p>
          <Link
            href="/studio#customise"
            className="shrink-0 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Set a goal
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <ProgressRing
            progress={goal.progress}
            size={72}
            label={`${Math.round(goal.progress * 100)}%`}
            tone={goal.progress >= 1 ? "emerald" : "primary"}
          />
          <div className="min-w-0">
            <p className="text-lg font-bold tabular-nums">
              {goal.published} of {goal.target}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {goal.published >= goal.target
                ? "Target met this week. Anything more is a bonus."
                : `${goal.target - goal.published} more this week to hit your target.`}
            </p>
          </div>
        </div>
      )}
    </StudioCard>
  );
}

export function LatestWorkWidget({ latest }: { latest: CreatorHome["latest"] }) {
  if (latest.length === 0) {
    return (
      <StudioCard title="Latest work" icon={Eye}>
        <EmptyNote>
          Nothing published yet. Your first post is what starts every number on this page.
        </EmptyNote>
      </StudioCard>
    );
  }

  return (
    <StudioCard
      title="Latest work"
      icon={Eye}
      action={
        <Link href="/studio/content" prefetch className="text-xs font-semibold text-primary hover:opacity-80">
          Manage all
        </Link>
      }
    >
      <ul className="space-y-2.5">
        {latest.map((post) => (
          <li key={post.id}>
            <Link
              href={`/studio/content/${post.id}`}
              prefetch={false}
              className="group flex items-center gap-3 rounded-2xl p-1.5 transition hover:bg-secondary/50"
            >
              {post.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="h-12 w-16 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <span className="h-12 w-16 shrink-0 rounded-xl bg-secondary" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium group-hover:underline">{post.title}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{relativeDay(post.createdAt)}</span>
                  {post.status !== "published" ? <Pill tone="amber">{post.status}</Pill> : null}
                  {post.completionRate > 0 ? <span>{Math.round(post.completionRate * 100)}% watched</span> : null}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums">{formatCompactNumber(post.views)}</span>
                <span className="text-[11px] text-muted-foreground">views</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </StudioCard>
  );
}

export function EngagementWidget({ analytics }: { analytics: CreatorHome["analytics"] }) {
  const rows = [
    { label: "Likes", value: analytics.totals.likes, icon: Heart, tone: "from-red-500 to-rose-400" },
    { label: "Comments", value: analytics.totals.comments, icon: MessageCircle, tone: "from-emerald-600 to-teal-400" },
    { label: "Shares", value: analytics.totals.shares, icon: Share2, tone: "from-violet-600 to-fuchsia-500" },
    { label: "Saves", value: analytics.totals.saves, icon: Bookmark, tone: "from-blue-600 to-cyan-400" },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <StudioCard title="Engagement overview" icon={Heart} subtitle={`${analytics.engagementRate}% of views engage`}>
      <div className="space-y-3">
        {rows.map((r) => (
          <MeterRow key={r.label} label={r.label} value={r.value} max={max} tone={r.tone} />
        ))}
      </div>
    </StudioCard>
  );
}

export function RecentFollowersWidget({ followers }: { followers: CreatorHome["recentFollowers"] }) {
  if (followers.length === 0) {
    return (
      <StudioCard title="Recent followers" icon={Users}>
        <EmptyNote>No new followers yet. They usually arrive after a post reaches beyond the people who already know you.</EmptyNote>
      </StudioCard>
    );
  }

  return (
    <StudioCard title="Recent followers" icon={Users}>
      <ul className="space-y-2">
        {followers.map((f) => (
          <li key={f.id}>
            <Link
              href={`/u/${f.handle}`}
              prefetch={false}
              className="group flex items-center gap-3 rounded-2xl p-1.5 transition hover:bg-secondary/50"
            >
              {f.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.avatarUrl} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold uppercase">
                  {f.handle.slice(0, 2)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium group-hover:underline">
                  {f.displayName ?? `@${f.handle}`}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">@{f.handle}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{relativeDay(f.followedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </StudioCard>
  );
}

export function NextMilestoneWidget({ step }: { step: JourneyStep | null }) {
  if (!step) {
    return (
      <StudioCard title="Next milestone" icon={Trophy}>
        <p className="text-xs text-muted-foreground">
          You&apos;ve reached every milestone on the ladder. That is not a sentence many people read.
        </p>
      </StudioCard>
    );
  }

  return (
    <StudioCard
      title="Next milestone"
      icon={Trophy}
      action={
        <Link href="/studio/journey" prefetch className="text-xs font-semibold text-primary hover:opacity-80">
          Full journey
        </Link>
      }
    >
      <div className="flex items-center gap-4">
        <ProgressRing progress={step.progress} size={72} label={`${Math.round(step.progress * 100)}%`} tone="amber" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{step.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
        </div>
      </div>
    </StudioCard>
  );
}

export function CommunityWidget({ lounge }: { lounge: CreatorHome["lounge"] }) {
  return (
    <StudioCard
      title="Community updates"
      icon={MessageCircle}
      subtitle={`You've replied to ${lounge.replyRatePercent}% of comments`}
      action={
        <Link href="/account/creator-lounge" prefetch className="text-xs font-semibold text-primary hover:opacity-80">
          Creator Lounge
        </Link>
      }
    >
      {lounge.unanswered.length === 0 ? (
        <EmptyNote>Nothing waiting on you. Every question on your posts has an answer.</EmptyNote>
      ) : (
        <ul className="space-y-2.5">
          {lounge.unanswered.slice(0, 4).map((q) => (
            <li key={q.commentId} className="rounded-2xl bg-secondary/40 p-3">
              <p className="line-clamp-2 text-xs leading-relaxed">{q.body}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {/* The author can be null — a deleted account, or a profile the
                    lounge could not resolve. The question is still real and
                    still unanswered, so it renders without a name. */}
                {q.author ? `@${q.author.handle} · ` : ""}
                {relativeDay(q.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </StudioCard>
  );
}

export function SuggestionsWidget({ suggestions }: { suggestions: ContentSuggestion[] }) {
  if (suggestions.length === 0) {
    return (
      <StudioCard title="Content suggestions" icon={Lightbulb}>
        <EmptyNote>
          Nothing to suggest yet. Suggestions here are derived from your own numbers, so they arrive once there
          are enough of them to say something true.
        </EmptyNote>
      </StudioCard>
    );
  }

  return (
    <StudioCard
      title="Content suggestions"
      icon={Lightbulb}
      subtitle="Each one comes from something measured about your work"
    >
      <ul className="space-y-3">
        {suggestions.map((s) => {
          const body = (
            <>
              <p className="text-sm font-semibold">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
              {/* 🔴 The measured fact behind the suggestion, always shown. A tip
                  a creator cannot trace to a real number is indistinguishable
                  from generic advice. */}
              {s.because ? (
                <p className="mt-2 border-l-2 border-primary/30 pl-2.5 text-[11px] italic text-muted-foreground/90">
                  {s.because}
                </p>
              ) : null}
            </>
          );
          return (
            <li key={s.id} className="rounded-2xl bg-secondary/40 p-3.5">
              {s.href ? (
                <Link href={s.href} prefetch={false} className="block transition hover:opacity-80">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </StudioCard>
  );
}

export function HealthWidget({ health }: { health: CreatorHealth }) {
  return (
    <StudioCard
      title="Creator Health"
      icon={Sparkles}
      action={
        <Link href="/studio/journey#health" prefetch className="text-xs font-semibold text-primary hover:opacity-80">
          Details
        </Link>
      }
    >
      {health.score === null ? (
        <EmptyNote>
          Not enough history to score yet. Health compares you against your own past, so it needs a few weeks of
          it before it can say anything honest.
        </EmptyNote>
      ) : (
        <div className="flex items-center gap-4">
          <ProgressRing
            progress={health.score / 100}
            size={72}
            label={String(health.score)}
            tone={health.score >= 70 ? "emerald" : health.score >= 50 ? "amber" : "rose"}
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            {health.pillars
              .filter((p) => p.score !== null)
              .slice(0, 3)
              .map((p) => (
                <div key={p.key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-muted-foreground">{p.label}</span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", (p.score ?? 0) < 50 && "text-amber-600 dark:text-amber-400")}>
                    {p.score}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </StudioCard>
  );
}

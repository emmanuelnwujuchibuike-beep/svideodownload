import { Flame, HelpCircle, MessageCircle, Reply, Sparkles, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { getCreatorLounge } from "@/lib/social/creator-lounge";
import { createClient } from "@/lib/supabase/server";
import { formatCompactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creator Lounge",
  robots: { index: false, follow: false },
};

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Creator Lounge™ (Feature 15 Part 5 tranche 4) — unanswered questions,
 * top-reacted comments, and active discussions across the signed-in
 * creator's own posts. Every number here is a real count of real rows (see
 * lib/social/creator-lounge.ts's own header) — no "trending" claim, no
 * invented topic clustering.
 */
export default async function CreatorLoungePage() {
  if (!hasSupabase) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/creator-lounge");

  const lounge = await getCreatorLounge(user.id);
  const isEmpty =
    lounge.unanswered.length === 0 &&
    lounge.topComments.length === 0 &&
    lounge.activeDiscussions.length === 0 &&
    lounge.topSupporters.length === 0;

  return (
    <AppContent>
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
            <Sparkles className="h-7 w-7 text-primary" /> Creator Lounge
          </h1>
          <p className="mt-2 text-muted-foreground">What&apos;s happening in the comments on your posts.</p>
        </header>

        {isEmpty ? (
          <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
            No comment activity to show yet — this fills in once people start commenting on your posts.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-soft">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                  <Reply className="h-[18px] w-[18px]" />
                </span>
                <p className="mt-4 text-2xl font-bold tracking-tight">{lounge.replyRatePercent}%</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Reply rate — top-level comments you&apos;ve directly replied to</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-soft">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                  <Users className="h-[18px] w-[18px]" />
                </span>
                <p className="mt-4 text-2xl font-bold tracking-tight">{lounge.topSupporters.length}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Regular commenters this window</p>
              </div>
            </div>

            {lounge.topSupporters.length > 0 ? (
              <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4 text-violet-500" /> Most active supporters
                </h2>
                <ul className="flex flex-wrap gap-3">
                  {lounge.topSupporters.map((s) => (
                    <li key={s.author.handle} className="flex items-center gap-2 rounded-full border border-border/60 bg-secondary/30 py-1.5 pl-1.5 pr-3">
                      {s.author.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.author.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-[10px] font-bold text-white">
                          {s.author.displayName.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="text-xs font-semibold">{s.author.displayName}</span>
                      <span className="text-xs text-muted-foreground">{s.commentCount}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {lounge.unanswered.length > 0 ? (
              <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <HelpCircle className="h-4 w-4 text-blue-500" /> Unanswered questions
                  <span className="text-muted-foreground">· {lounge.unanswered.length}</span>
                </h2>
                <ul className="space-y-3">
                  {lounge.unanswered.map((q) => (
                    <li key={q.commentId}>
                      <Link href={`/p/${q.postId}#comments`} className="group flex items-start gap-3">
                        {q.author?.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={q.author.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-xs font-bold text-white">
                            {q.author?.displayName.charAt(0).toUpperCase() ?? "?"}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">
                            <span className="font-semibold">{q.author?.displayName ?? "Unknown"}</span>{" "}
                            <span className="text-muted-foreground group-hover:text-foreground">{q.body}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">on {q.postTitle}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {lounge.activeDiscussions.length > 0 ? (
              <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <Flame className="h-4 w-4 text-orange-500" /> Active discussions
                  <span className="text-muted-foreground">· last 48h</span>
                </h2>
                <ul className="space-y-2">
                  {lounge.activeDiscussions.map((d) => (
                    <li key={d.postId}>
                      <Link href={`/p/${d.postId}#comments`} className="flex items-center justify-between gap-3 text-sm hover:underline">
                        <span className="min-w-0 flex-1 truncate">{d.postTitle}</span>
                        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{formatCompactNumber(d.recentCommentCount)} new</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {lounge.topComments.length > 0 ? (
              <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <MessageCircle className="h-4 w-4 text-emerald-500" /> Most-reacted comments
                </h2>
                <ul className="space-y-3">
                  {lounge.topComments.map((c) => (
                    <li key={c.commentId}>
                      <Link href={`/p/${c.postId}#comments`} className="group flex items-start gap-3">
                        {c.author?.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.author.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-xs font-bold text-white">
                            {c.author?.displayName.charAt(0).toUpperCase() ?? "?"}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">
                            <span className="font-semibold">{c.author?.displayName ?? "Unknown"}</span>{" "}
                            <span className="text-muted-foreground group-hover:text-foreground">{c.body}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">on {c.postTitle}</span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{formatCompactNumber(c.reactionCount)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </AppContent>
  );
}

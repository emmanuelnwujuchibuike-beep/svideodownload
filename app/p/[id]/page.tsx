import { createHash } from "node:crypto";

import { BadgeCheck, CalendarDays, Download, Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { isAdmin } from "@/lib/admin";
import { SiteHeader } from "@/components/layout/site-header";
import { RichText } from "@/components/social/rich-text";
import { PostEditButton } from "@/features/social/post-edit-button";
import { PostGrid } from "@/components/social/post-grid";
import { Comments } from "@/features/social/comments";
import { FollowButton } from "@/features/social/follow-button";
import { PostDeleteButton } from "@/features/social/post-delete-button";
import { PostDownloadButton } from "@/features/social/post-download-button";
import { PostEngagement } from "@/features/social/post-engagement";
import { ReportButton } from "@/features/social/report-button";
import { categoryLabel } from "@/lib/social/categories";
import { getUserPlan } from "@/lib/monetization/plan";
import { canComment, getViewerReactions, listComments } from "@/lib/social/engagement";
import { getPoll } from "@/lib/social/polls";
import { PostPoll, PollCreator } from "@/features/social/post-poll";
import { PostMedia } from "@/features/social/post-media";
import type { FeedItem } from "@/lib/social/home-feed";
import { getPost, recordPostView, relatedPosts } from "@/lib/social/posts";
import { createClient } from "@/lib/supabase/server";
import { formatCompactNumber } from "@/lib/utils";

const COMMENT_GATE_MSG: Record<string, string> = {
  off: "Comments are turned off for this post.",
  followers: "Only the creator's followers can comment.",
  blocked: "You can't comment here.",
  unavailable: "Comments are unavailable.",
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function viewer(): Promise<{ id: string | null; admin: boolean }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { id: null, admin: false };
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    return { id: user.id, admin: isAdmin(profile?.role, user.email) };
  } catch {
    return { id: null, admin: false };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Not found", robots: { index: false, follow: false } };
  const post = await getPost(id, null);
  if (!post) return { title: "Not found", robots: { index: false, follow: false } };
  return {
    title: post.title,
    description: post.description ?? `Watch & download from ${post.platform} on FrenzSave.`,
    alternates: { canonical: `/p/${post.id}` },
    robots: { index: post.indexable, follow: post.indexable },
    openGraph: {
      type: "video.other",
      title: post.title,
      description: post.description ?? undefined,
      images: post.thumbnail_url ? [{ url: post.thumbnail_url }] : undefined,
    },
  };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { id: me, admin: viewerIsAdmin } = await viewer();
  const post = await getPost(id, me, viewerIsAdmin);
  if (!post) notFound();

  // Deduped view (per viewer|ip per day) — fire and forget. Don't count the
  // owner viewing their own post.
  if (!post.isOwner) {
    const ipHash = createHash("sha256")
      .update((((await headers()).get("x-forwarded-for") ?? "").split(",")[0] || "anon").trim())
      .digest("hex");
    void recordPostView(post.id, me, ipHash);
  }

  const [plan, related, reactions, comments, gate, poll] = await Promise.all([
    getUserPlan(post.publisher_id),
    relatedPosts(post),
    getViewerReactions(post.id, me),
    listComments(post.id, post.publisher_id, me),
    me ? canComment(post.id, me) : Promise.resolve(null),
    getPoll(post.id, me),
  ]);
  const commentDisabled =
    gate && !gate.ok ? (COMMENT_GATE_MSG[gate.reason] ?? "Comments are unavailable.") : null;

  // A rich media item so the hero can play inline + open a full reel-quality viewer.
  const mediaItem: FeedItem = {
    id: post.id,
    title: post.title,
    description: post.description,
    platform: post.platform,
    mediaKind: post.media_kind,
    thumbnailUrl: post.thumbnail_url,
    sourceUrl: post.source_url,
    mediaUrl: post.media_url,
    streamUid: post.stream_uid,
    category: post.category,
    durationSec: post.duration_sec,
    viewsCount: post.views_count,
    likesCount: post.likes_count,
    commentsCount: post.comments_count,
    sharesCount: post.shares_count,
    savesCount: post.saves_count,
    downloadsCount: post.downloads_count,
    createdAt: post.created_at,
    publisher: {
      id: post.publisher.id,
      handle: post.publisher.handle,
      displayName: post.publisher.displayName,
      avatarUrl: post.publisher.avatarUrl,
      isVerified: post.publisher.isVerified,
      plan,
    },
    viewerLiked: reactions.liked,
    viewerSaved: reactions.saved,
    isFollowing: post.publisher.isFollowing,
    isOwner: post.isOwner,
  };

  const ld = {
    "@context": "https://schema.org",
    "@type": post.media_kind === "image" ? "ImageObject" : "VideoObject",
    name: post.title,
    ...(post.description ? { description: post.description } : {}),
    ...(post.thumbnail_url ? { thumbnailUrl: post.thumbnail_url } : {}),
    uploadDate: post.created_at,
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/WatchAction",
      userInteractionCount: post.views_count,
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <SiteHeader social />
      <main className="container max-w-3xl pb-24 pt-28 sm:pt-32">
        {post.status !== "published" ? (
          <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
            This post is <strong>{post.status.replace("_", " ")}</strong> and isn&apos;t publicly visible.
          </div>
        ) : null}

        {/* Hero media — plays inline + opens a full reel-quality viewer */}
        <PostMedia item={mediaItem} />

        {/* Title + meta */}
        <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-[-0.02em] sm:text-2xl">{post.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {post.source_author ? <span>by {post.source_author}</span> : null}
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                {new Date(post.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
              </span>
              {post.category ? (
                <Link href={`/explore?category=${post.category}`} className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-foreground transition hover:bg-secondary/70">
                  {categoryLabel(post.category)}
                </Link>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PostDownloadButton postId={post.id} sourceUrl={post.source_url} mediaKind={post.media_kind} title={post.title} />
            {post.isOwner ? (
              <>
                <PostEditButton
                  postId={post.id}
                  initialTitle={post.title}
                  initialDescription={post.description}
                  initialCategory={post.category}
                  initialVisibility={post.visibility}
                />
                <PostDeleteButton postId={post.id} redirectTo={`/u/${post.publisher.handle}`} />
              </>
            ) : (
              <ReportButton targetType="post" targetId={post.id} />
            )}
          </div>
        </div>

        {post.description ? (
          <p className="mt-4 leading-relaxed text-muted-foreground">
            <RichText text={post.description} />
          </p>
        ) : null}

        {/* Engagement + reach */}
        <div className="mt-5">
          <PostEngagement
            postId={post.id}
            loggedIn={!!me}
            initial={{
              liked: reactions.liked,
              saved: reactions.saved,
              likes: post.likes_count,
              saves: post.saves_count,
              shares: post.shares_count,
              comments: post.comments_count,
            }}
          />
          <p className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" /> {formatCompactNumber(post.views_count)} views
            </span>
            <span className="inline-flex items-center gap-1">
              <Download className="h-3.5 w-3.5" /> {formatCompactNumber(post.downloads_count)} downloads
            </span>
          </p>
        </div>

        {/* Creator */}
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-soft">
          <Link href={`/u/${post.publisher.handle}`} className="shrink-0">
            {post.publisher.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.publisher.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-lg font-bold text-white">
                {post.publisher.displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </Link>
          <Link href={`/u/${post.publisher.handle}`} className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-semibold">{post.publisher.displayName}</span>
              {post.publisher.isVerified ? <BadgeCheck className="h-4 w-4 shrink-0 text-primary" /> : null}
              <DiamondCrownBadge plan={plan} size="xs" />
            </span>
            <span className="block truncate text-sm text-muted-foreground">@{post.publisher.handle}</span>
          </Link>
          {post.isOwner ? null : <FollowButton targetId={post.publisher.id} initialFollowing={post.publisher.isFollowing} canFollow={!!me} />}
        </div>

        {/* Poll (vote) — render if one exists; otherwise let the owner add one */}
        {poll ? <PostPoll initial={poll} loggedIn={!!me} /> : post.isOwner ? <PollCreator postId={post.id} /> : null}

        {/* Comments */}
        <Comments
          postId={post.id}
          comments={comments}
          loggedIn={!!me}
          canComment={!!gate?.ok}
          disabledReason={commentDisabled}
          count={post.comments_count}
        />

        {/* Related */}
        {related.length > 0 ? (
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold tracking-[-0.02em]">Related downloads</h2>
            <PostGrid posts={related} />
          </section>
        ) : null}
      </main>
    </>
  );
}

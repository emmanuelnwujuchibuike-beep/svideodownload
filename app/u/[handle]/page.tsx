import { BadgeCheck, CalendarDays, Link as LinkIcon, Lock, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { SiteHeader } from "@/components/layout/site-header";
import { PostGrid } from "@/components/social/post-grid";
import { AddFriendButton } from "@/features/friends/add-friend-button";
import { IdentityRing } from "@/features/profile/identity-ring";
import { LivingGlow } from "@/features/profile/living-glow";
import { ProfileCompletion } from "@/features/profile/profile-completion";
import { ShareProfileButton } from "@/features/profile/share-profile-button";
import { FollowButton } from "@/features/social/follow-button";
import { ProfileActions } from "@/features/social/profile-actions";
import { PostGridSkeleton } from "@/features/ui/page-skeletons";
import { getUserPlan } from "@/lib/monetization/plan";
import { friendsCount, friendshipState, mutualFriendsCount } from "@/lib/social/friends";
import { createAdminClient } from "@/lib/supabase/admin";
import { listUserPosts } from "@/lib/social/posts";
import { getPublicProfile } from "@/lib/social/profile";
import { createClient } from "@/lib/supabase/server";
import { formatCompactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function viewerId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const profile = await getPublicProfile(handle, null);
  if (!profile) return { title: "Profile not found", robots: { index: false, follow: false } };
  const indexable = profile.visibility === "public";
  return {
    title: `${profile.displayName} (@${profile.handle})`,
    description: profile.bio ?? `${profile.displayName} on FrenzSave.`,
    alternates: { canonical: `/u/${profile.handle}` },
    robots: { index: indexable, follow: indexable },
    openGraph: {
      type: "profile",
      title: `${profile.displayName} (@${profile.handle})`,
      description: profile.bio ?? `${profile.displayName} on FrenzSave.`,
      images: profile.avatarUrl ? [{ url: profile.avatarUrl }] : undefined,
    },
  };
}

async function publishedPostsCount(profileId: string, isOwner: boolean): Promise<number> {
  try {
    let q = createAdminClient()
      .from("posts")
      .select("id", { head: true, count: "exact" })
      .eq("publisher_id", profileId)
      .eq("status", "published");
    if (!isOwner) q = q.eq("visibility", "public");
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ handle }, { tab }] = await Promise.all([params, searchParams]);
  const me = await viewerId();
  const profile = await getPublicProfile(handle, me);
  if (!profile) notFound();

  // The profile header renders immediately; the (heavier) posts grid streams in
  // behind a skeleton so the page never blocks on the post query.
  const isViewer = !!me && !profile.isOwner;
  const [plan, friendState, mutuals, friendTotal, postsTotal] = await Promise.all([
    getUserPlan(profile.id),
    isViewer ? friendshipState(me!, profile.id) : Promise.resolve("none" as const),
    isViewer ? mutualFriendsCount(me!, profile.id) : Promise.resolve(0),
    friendsCount(profile.id),
    publishedPostsCount(profile.id, profile.isOwner),
  ]);
  const activeTab = tab === "videos" || tab === "photos" ? tab : "posts";

  const ld = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": "Person",
      name: profile.displayName,
      alternateName: `@${profile.handle}`,
      ...(profile.bio ? { description: profile.bio } : {}),
      ...(profile.avatarUrl ? { image: profile.avatarUrl } : {}),
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <SiteHeader social />
      <main className="pb-24 pt-14 sm:pt-16">
        <div className="mx-auto max-w-4xl sm:px-4">
          {/* Banner + Living Profile time-of-day glow. Full-bleed on mobile,
              a contained rounded hero on larger screens (professional, balanced). */}
          <div className="relative h-40 w-full overflow-hidden bg-gradient-to-br from-blue-600/30 via-violet-500/15 to-purple-500/20 sm:h-56 sm:rounded-3xl md:h-64">
            {profile.bannerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.bannerUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
            <LivingGlow />
          </div>

          <div className="px-4 sm:px-6">
            {/* Avatar + actions — avatar stacks above a full-width wrapping action
                bar on mobile; sits inline with right-aligned actions on desktop. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="relative -mt-12 w-fit sm:-mt-20">
                <IdentityRing userId={profile.id} verified={profile.isVerified} premium={plan !== "free"}>
                  {profile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatarUrl}
                      alt=""
                      className="block h-24 w-24 rounded-full object-cover ring-4 ring-background sm:h-32 sm:w-32"
                    />
                  ) : (
                    <span className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-3xl font-bold text-white ring-4 ring-background sm:h-32 sm:w-32 sm:text-4xl">
                      {profile.displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                </IdentityRing>
                <DiamondCrownBadge plan={plan} size="md" className="absolute bottom-1 right-1 z-10 ring-2 ring-background" />
              </div>

              {/* Edge-to-edge scrollable action bar on mobile (every button
                  reachable, no cramped wrapping); right-aligned inline on desktop. */}
              <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mb-2 sm:justify-end sm:overflow-visible sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {profile.isOwner ? (
                  <>
                    <Link
                      href="/account#profile"
                      className="inline-flex shrink-0 items-center rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary"
                    >
                      Edit profile
                    </Link>
                    <span className="shrink-0">
                      <ShareProfileButton handle={profile.handle} name={profile.displayName} />
                    </span>
                  </>
                ) : (
                  <>
                    {me && friendState !== "self" ? (
                      <AddFriendButton
                        targetId={profile.id}
                        targetName={profile.displayName}
                        targetHandle={profile.handle}
                        targetAvatarUrl={profile.avatarUrl}
                        mutualCount={mutuals}
                        initialState={friendState}
                        className="shrink-0"
                      />
                    ) : null}
                    <FollowButton
                      targetId={profile.id}
                      initialFollowing={profile.isFollowing}
                      canFollow={!!me}
                      className="shrink-0"
                    />
                    {me ? (
                      <>
                        <Link
                          href={`/messages/new/${profile.id}`}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-semibold transition hover:bg-secondary"
                        >
                          <MessageCircle className="h-4 w-4" /> Message
                        </Link>
                        <span className="shrink-0">
                          <ShareProfileButton handle={profile.handle} name={profile.displayName} />
                        </span>
                        <span className="shrink-0">
                          <ProfileActions
                            targetId={profile.id}
                            handle={profile.handle}
                            initialBlocked={profile.viewerHasBlocked}
                          />
                        </span>
                      </>
                    ) : (
                      <span className="shrink-0">
                        <ShareProfileButton handle={profile.handle} name={profile.displayName} />
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Identity */}
            <div className="mt-4">
              <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
                {profile.displayName}
                {profile.isVerified ? <BadgeCheck className="h-5 w-5 text-primary sm:h-6 sm:w-6" /> : null}
                <DiamondCrownBadge plan={plan} size="sm" showLabel />
              </h1>
              <p className="mt-0.5 text-muted-foreground">
                @{profile.handle}
                {isViewer && mutuals > 0 ? (
                  <span className="ml-2 rounded-full bg-gradient-to-r from-blue-500/15 to-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-500 dark:text-violet-300">
                    {mutuals} mutual friend{mutuals === 1 ? "" : "s"}
                  </span>
                ) : null}
              </p>
            </div>

            {profile.isOwner ? (
              <ProfileCompletion
                hasAvatar={!!profile.avatarUrl}
                hasBio={!!profile.bio}
                hasBanner={!!profile.bannerUrl}
                hasWebsite={!!profile.website}
              />
            ) : null}

            {profile.restricted ? (
              <div className="mt-8 rounded-2xl border border-border bg-card p-8 text-center">
                <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 font-semibold">This account is private</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {me ? "Follow to request access to their activity." : "Sign in and follow to see more."}
                </p>
              </div>
            ) : (
              <>
                {profile.bio ? <p className="mt-4 max-w-2xl leading-relaxed">{profile.bio}</p> : null}

                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                  {profile.website ? (
                    <a
                      href={profile.website}
                      target="_blank"
                      rel="nofollow noopener"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <LinkIcon className="h-4 w-4" />
                      {profile.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : null}
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4" />
                    Joined {new Date(profile.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                  </span>
                </div>

                {/* Live stats row — spans the full width for a balanced, pro layout */}
                <div className="mt-5 grid grid-cols-4 gap-2.5 sm:gap-3">
                  <Link
                    href={`/u/${profile.handle}/following`}
                    className="rounded-2xl border border-border/60 bg-card/60 px-2 py-3 text-center backdrop-blur transition hover:bg-card sm:py-4"
                  >
                    <span className="block text-lg font-bold tracking-tight sm:text-xl">{formatCompactNumber(profile.followingCount)}</span>
                    <span className="text-[11px] text-muted-foreground sm:text-xs">Following</span>
                  </Link>
                  <Link
                    href={`/u/${profile.handle}/followers`}
                    className="rounded-2xl border border-border/60 bg-card/60 px-2 py-3 text-center backdrop-blur transition hover:bg-card sm:py-4"
                  >
                    <span className="block text-lg font-bold tracking-tight sm:text-xl">{formatCompactNumber(profile.followersCount)}</span>
                    <span className="text-[11px] text-muted-foreground sm:text-xs">Followers</span>
                  </Link>
                  <div className="rounded-2xl border border-border/60 bg-card/60 px-2 py-3 text-center backdrop-blur sm:py-4">
                    <span className="block text-lg font-bold tracking-tight sm:text-xl">{formatCompactNumber(friendTotal)}</span>
                    <span className="text-[11px] text-muted-foreground sm:text-xs">Friends</span>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-card/60 px-2 py-3 text-center backdrop-blur sm:py-4">
                    <span className="block text-lg font-bold tracking-tight sm:text-xl">{formatCompactNumber(postsTotal)}</span>
                    <span className="text-[11px] text-muted-foreground sm:text-xs">Posts</span>
                  </div>
                </div>

                {/* Content tabs + streamed grid */}
                <div className="mt-8">
                  <div className="mb-4 flex gap-1.5 border-b border-border/60 pb-3">
                    {(
                      [
                        { id: "posts", label: "Posts" },
                        { id: "videos", label: "Videos" },
                        { id: "photos", label: "Photos" },
                      ] as const
                    ).map((t) => (
                      <Link
                        key={t.id}
                        href={t.id === "posts" ? `/u/${profile.handle}` : `/u/${profile.handle}?tab=${t.id}`}
                        scroll={false}
                        className={
                          activeTab === t.id
                            ? "rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25"
                            : "rounded-full border border-border/70 bg-card/60 px-5 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                        }
                      >
                        {t.label}
                      </Link>
                    ))}
                  </div>
                  <Suspense key={activeTab} fallback={<PostGridSkeleton count={6} />}>
                    <ProfilePosts profileId={profile.id} viewerId={me} isOwner={profile.isOwner} filter={activeTab} />
                  </Suspense>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

/** A user's published posts — streamed behind a Suspense boundary on the profile. */
async function ProfilePosts({
  profileId,
  viewerId,
  isOwner,
  filter = "posts",
}: {
  profileId: string;
  viewerId: string | null;
  isOwner: boolean;
  filter?: "posts" | "videos" | "photos";
}) {
  const all = await listUserPosts(profileId, viewerId);
  const posts =
    filter === "videos"
      ? all.filter((p) => p.mediaKind === "video")
      : filter === "photos"
        ? all.filter((p) => p.mediaKind === "image")
        : all;
  return (
    <PostGrid
      posts={posts}
      layout={filter === "videos" ? "reel" : filter === "photos" ? "photo" : "card"}
      emptyText={
        filter !== "posts"
          ? `No ${filter} yet.`
          : isOwner
            ? "You haven't published anything yet — publish a download from the result page."
            : "No public posts yet."
      }
    />
  );
}

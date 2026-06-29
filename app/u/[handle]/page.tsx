import { BadgeCheck, CalendarDays, Link as LinkIcon, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PostGrid } from "@/components/social/post-grid";
import { FollowButton } from "@/features/social/follow-button";
import { ProfileActions } from "@/features/social/profile-actions";
import { getUserPlan } from "@/lib/monetization/plan";
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

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const me = await viewerId();
  const profile = await getPublicProfile(handle, me);
  if (!profile) notFound();

  const [plan, posts] = await Promise.all([
    getUserPlan(profile.id),
    profile.restricted ? Promise.resolve([]) : listUserPosts(profile.id, me),
  ]);

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
      <SiteHeader />
      <main className="pb-24 pt-16">
        {/* Banner */}
        <div className="relative h-40 w-full overflow-hidden bg-gradient-to-br from-blue-600/30 via-sky-500/15 to-cyan-400/20 sm:h-52">
          {profile.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.bannerUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="container max-w-3xl">
          {/* Avatar + actions row */}
          <div className="flex items-end justify-between">
            <div className="relative -mt-12 sm:-mt-16">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt=""
                  className="h-24 w-24 rounded-full object-cover ring-4 ring-background sm:h-28 sm:w-28"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-3xl font-bold text-white ring-4 ring-background sm:h-28 sm:w-28">
                  {profile.displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <DiamondCrownBadge plan={plan} size="md" className="absolute bottom-1 right-1 ring-2 ring-background" />
            </div>

            <div className="mb-2 flex items-center gap-2">
              {profile.isOwner ? (
                <Link
                  href="/account#profile"
                  className="inline-flex items-center rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary"
                >
                  Edit profile
                </Link>
              ) : (
                <>
                  <FollowButton
                    targetId={profile.id}
                    initialFollowing={profile.isFollowing}
                    canFollow={!!me}
                  />
                  {me ? (
                    <ProfileActions
                      targetId={profile.id}
                      handle={profile.handle}
                      initialBlocked={profile.viewerHasBlocked}
                    />
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* Identity */}
          <div className="mt-4">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em]">
              {profile.displayName}
              {profile.isVerified ? <BadgeCheck className="h-5 w-5 text-primary" /> : null}
              <DiamondCrownBadge plan={plan} size="sm" showLabel />
            </h1>
            <p className="text-muted-foreground">@{profile.handle}</p>
          </div>

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
              {profile.bio ? <p className="mt-4 leading-relaxed">{profile.bio}</p> : null}

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

              <div className="mt-4 flex gap-6 text-sm">
                <Link href={`/u/${profile.handle}/following`} className="transition hover:underline">
                  <strong className="font-semibold">{formatCompactNumber(profile.followingCount)}</strong>{" "}
                  <span className="text-muted-foreground">Following</span>
                </Link>
                <Link href={`/u/${profile.handle}/followers`} className="transition hover:underline">
                  <strong className="font-semibold">{formatCompactNumber(profile.followersCount)}</strong>{" "}
                  <span className="text-muted-foreground">Followers</span>
                </Link>
              </div>

              {/* Published downloads */}
              <div className="mt-8">
                <PostGrid
                  posts={posts}
                  emptyText={
                    profile.isOwner
                      ? "You haven't published anything yet — publish a download from the result page."
                      : "No public posts yet."
                  }
                />
              </div>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

import { BadgeCheck, CalendarDays, Camera, Link as LinkIcon, Lock, MessageCircle, MoreHorizontal, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { SiteHeader } from "@/components/layout/site-header";
import { jsonLd } from "@/lib/seo/json-ld";
import { CreatorRail } from "@/features/profile/creator-rail";
import type { TopContent } from "@/features/profile/identity-analytics";
import { notificationsToActivity } from "@/features/profile/activity-map";
import { listNotifications } from "@/lib/social/notifications";
import { ProfileTabs } from "@/features/profile/profile-tabs";
import { AddFriendButton } from "@/features/friends/add-friend-button";
import { IdentityRing } from "@/features/profile/identity-ring";
import { friendIdSet } from "@/lib/social/friend-ids";
import { ProfileMobileMenu } from "@/features/profile/profile-mobile-menu";
import { Toaster } from "@/features/ui/toast";
import { LivingGlow } from "@/features/profile/living-glow";
import { ProfileMenu } from "@/features/profile/profile-menu";
import { SuggestionsLauncher } from "@/features/friends/suggestions-launcher";
import { ShareProfileButton } from "@/features/profile/share-profile-button";
import { FollowButton } from "@/features/social/follow-button";
import { ProfileActions } from "@/features/social/profile-actions";
import { PostGridSkeleton } from "@/features/ui/page-skeletons";
import { getUserPlan } from "@/lib/monetization/plan";
import { friendsCount, friendshipState, mutualFriendsCount } from "@/lib/social/friends";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewableCollectionsCount } from "@/lib/social/collections";
import { listLikedPosts, listSavedPosts, listUserPosts, listUserReposts } from "@/lib/social/posts";
import { accentHex, getPrivacySettings, getProfileExtras, getProfileMedia, getPublicProfile, getReputationBonus, tabVisible } from "@/lib/social/profile";
import { IdentityMedia } from "@/features/profile/identity-media";
import { IdentityMediaViewer } from "@/features/profile/identity-media-viewer";
import { computeReputation } from "@/lib/social/reputation";
import { computeAchievements, earnedCount } from "@/lib/social/achievements";
import { buildLifeJourney } from "@/lib/social/life-journey";
import { createClient } from "@/lib/supabase/server";
import { formatCompactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ProfileTab = "posts" | "reels" | "downloads" | "reposted" | "liked" | "saved" | "collections";
// Posts / Reels / Downloads are always public; the activity tabs (Reposts, Liked,
// Saved, Collections) each honour their own per-tab visibility (Repost spec §7)
// and are hidden entirely from viewers who aren't allowed to see them.
const BASE_TABS: ProfileTab[] = ["posts", "reels", "downloads"];

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

/** The creator's earliest published post — the "First post" Life Journey milestone. */
async function firstPublishedPost(profileId: string): Promise<{ id: string; title: string | null; thumbnailUrl: string | null; createdAt: string } | null> {
  try {
    const { data } = await createAdminClient()
      .from("posts")
      .select("id, title, thumbnail_url, media_url, created_at")
      .eq("publisher_id", profileId)
      .eq("status", "published")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as { id: string; title: string | null; thumbnail_url: string | null; media_url: string | null; created_at: string };
    return { id: row.id, title: row.title, thumbnailUrl: row.thumbnail_url ?? row.media_url, createdAt: row.created_at };
  } catch {
    return null;
  }
}

/** Engagement totals across a creator's published posts. Likes + views drive the
 *  hero stats; comments/shares/saves + the highest-viewed post feed the Identity
 *  Analytics panel. Everything is summed from real rows — no fabricated numbers. */
async function creatorTotals(profileId: string): Promise<{
  likes: number;
  views: number;
  comments: number;
  shares: number;
  saves: number;
  topPost: TopContent | null;
}> {
  try {
    const { data } = await createAdminClient()
      .from("posts")
      .select("id, title, thumbnail_url, media_url, likes_count, views_count, comments_count, shares_count, saves_count")
      .eq("publisher_id", profileId)
      .eq("status", "published");
    let likes = 0;
    let views = 0;
    let comments = 0;
    let shares = 0;
    let saves = 0;
    let topPost: TopContent | null = null;
    for (const r of (data ?? []) as {
      id: string;
      title: string | null;
      thumbnail_url: string | null;
      media_url: string | null;
      likes_count: number | null;
      views_count: number | null;
      comments_count: number | null;
      shares_count: number | null;
      saves_count: number | null;
    }[]) {
      const v = r.views_count ?? 0;
      const l = r.likes_count ?? 0;
      likes += l;
      views += v;
      comments += r.comments_count ?? 0;
      shares += r.shares_count ?? 0;
      saves += r.saves_count ?? 0;
      if (!topPost || v > topPost.views) {
        topPost = { id: r.id, title: r.title, thumbnailUrl: r.thumbnail_url ?? r.media_url, views: v, likes: l };
      }
    }
    return { likes, views, comments, shares, saves, topPost };
  } catch {
    return { likes: 0, views: 0, comments: 0, shares: 0, saves: 0, topPost: null };
  }
}

/** A few real friends for the creator rail's "Top Friends". */
async function topFriends(viewerId: string): Promise<{ name: string; handle: string; avatarUrl: string | null }[]> {
  try {
    const ids = [...(await friendIdSet(viewerId))].slice(0, 8);
    if (ids.length === 0) return [];
    const { data } = await createAdminClient()
      .from("profiles")
      .select("handle, display_name, avatar_url")
      .in("id", ids)
      .limit(5);
    return ((data ?? []) as { handle: string | null; display_name: string | null; avatar_url: string | null }[])
      .filter((p) => p.handle)
      .map((p) => ({ name: p.display_name || `@${p.handle}`, handle: p.handle as string, avatarUrl: p.avatar_url }));
  } catch {
    return [];
  }
}

/** Does this profile follow the viewer back? Powers the "Follows you" relationship
 *  signal (Identity Presence™). A single count query; fails closed to false. */
async function followsViewer(profileId: string, viewerId: string): Promise<boolean> {
  try {
    const { count } = await createAdminClient()
      .from("follows")
      .select("follower_id", { head: true, count: "exact" })
      .eq("follower_id", profileId)
      .eq("following_id", viewerId);
    return (count ?? 0) > 0;
  } catch {
    return false;
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
  const [plan, friendState, mutuals, friendTotal, postsTotal, privacy, collectionsN, followsYou, profileExtras] = await Promise.all([
    getUserPlan(profile.id),
    isViewer ? friendshipState(me!, profile.id) : Promise.resolve("none" as const),
    isViewer ? mutualFriendsCount(me!, profile.id) : Promise.resolve(0),
    friendsCount(profile.id),
    publishedPostsCount(profile.id, profile.isOwner),
    getPrivacySettings(profile.id),
    viewableCollectionsCount(profile.id, me, profile.isFollowing),
    isViewer ? followsViewer(profile.id, me!) : Promise.resolve(false),
    getProfileExtras(profile.id),
  ]);
  // Digital Identity media (migration 0098) — the identity the profile displays.
  const profileMedia = await getProfileMedia(profile.id);
  // The member's chosen accent (migration 0096), mapped to a hex, or null.
  const heroAccent = accentHex(profileExtras.accent);

  // Per-tab visibility: activity tabs appear only when the viewer is allowed to
  // see them (owner always; public → everyone; followers → the viewer follows).
  // Collections gate on whether any collection is actually visible to the viewer
  // (each collection carries its own visibility).
  const tabs: ProfileTab[] = [...BASE_TABS];
  if (tabVisible(privacy.reposts_visibility, profile.isOwner, profile.isFollowing)) tabs.push("reposted");
  if (tabVisible(privacy.likes_visibility, profile.isOwner, profile.isFollowing)) tabs.push("liked");
  if (tabVisible(privacy.saves_visibility, profile.isOwner, profile.isFollowing)) tabs.push("saved");
  if (profile.isOwner || collectionsN > 0) tabs.push("collections");
  const activeTab: ProfileTab = tabs.includes(tab as ProfileTab) ? (tab as ProfileTab) : "posts";

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

  // OWNER — the creator profile (design: public/mainprofile.jpg): the shared app
  // sidebar + top bar (from the layout), a center column (cover · identity ·
  // Creator badge · 5 stats · real posts tabs) and a right rail (About Me ·
  // Creator Tools · Achievements · Top Friends · Recent Activity). Everything is
  // the viewer's REAL data; tools without a backend announce "coming soon".
  if (profile.isOwner) {
    const [totals, friends, notifs, repBonus, firstPost] = await Promise.all([
      creatorTotals(profile.id),
      topFriends(profile.id),
      listNotifications(profile.id, 12),
      getReputationBonus(profile.id),
      firstPublishedPost(profile.id),
    ]);
    const activity = notificationsToActivity(notifs.items);
    const joined = `Joined ${new Date(profile.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`;
    // Reputation + Achievements — both DERIVED from the same real signals (no
    // fabrication). See lib/social/reputation.ts and lib/social/achievements.ts.
    const accountAgeDays = Math.max(0, Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86_400_000));
    const reputation = computeReputation({
      accountAgeDays,
      posts: postsTotal,
      followers: profile.followersCount,
      friends: friendTotal,
      engagementReceived: totals.likes + totals.comments + totals.shares + totals.saves,
      views: totals.views,
      collections: collectionsN,
      verified: profile.isVerified,
      bonus: repBonus,
    });
    const achievements = computeAchievements({
      accountAgeDays,
      posts: postsTotal,
      followers: profile.followersCount,
      friends: friendTotal,
      likes: totals.likes,
      views: totals.views,
      collections: collectionsN,
      verified: profile.isVerified,
      reputationScore: reputation.score,
    });
    // Life Journey™ — real dated milestones (joined, first post) + current-state
    // highlights (posts, friends, rank, achievements). No invented events.
    const journey = buildLifeJourney({
      joinedAt: profile.createdAt,
      firstPost,
      rankName: reputation.rank.name,
      achievementsEarned: earnedCount(achievements),
      postsCount: postsTotal,
      friendsCount: friendTotal,
    });
    const stats: { label: string; value: number }[] = [
      { label: "Posts", value: postsTotal },
      { label: "Followers", value: profile.followersCount },
      { label: "Following", value: profile.followingCount },
      { label: "Likes", value: totals.likes },
      { label: "Views", value: totals.views },
    ];
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
        <ProfileMobileMenu />
        <main className="pb-24 pt-[calc(var(--frenz-safe-top)+4rem)] lg:pt-4">
          {/* `frenz-profile-shell/cols/rail` (globals.css) put the rail beside
              the center only when the wrapper's OWN width — inside the app
              sidebar — passes 62rem, so it never clips on a laptop. */}
          <div className="frenz-profile-shell mx-auto w-full max-w-7xl px-0 sm:px-4">
            <div className="frenz-profile-cols flex flex-col gap-6">
              <div className="min-w-0 flex-1">
              {/* Hero — cover + glass Identity Card (Profile · Part 1). The
                  approved creator spine is kept; the craft is raised: the identity
                  now lives on a `.glass-strong` prestige card straddled by the
                  avatar, with an honest Photo/Video/Avatar mode control. */}
              <div className="relative">
                {/* Cover — Living Profile light or the creator's own banner */}
                <div className="relative h-44 w-full overflow-hidden bg-gradient-to-br from-fuchsia-600/40 via-violet-600/30 to-indigo-700/40 sm:h-60 sm:rounded-3xl">
                  {profile.bannerUrl ? (
                    <Image src={profile.bannerUrl} alt="" fill priority sizes="(max-width: 1024px) 100vw, 900px" className="object-cover" />
                  ) : null}
                  {/* Living Profile lighting always overlays (even over a banner), so
                      the time-of-day / seasonal / anniversary glow is visible to the
                      owner too — not just when they have no banner. */}
                  <LivingGlow joinedAt={profile.createdAt} />
                  {/* Top gloss + bottom scrim so the overlapping card reads cleanly over any cover */}
                  <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/25" />
                  <div className="absolute right-3 top-3 flex items-center gap-2 pt-[var(--frenz-safe-top)] sm:pt-0">
                    <Link href="/account/identity" className="inline-flex items-center gap-1.5 rounded-xl bg-black/40 px-3 py-2 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-black/55">
                      <Camera className="h-4 w-4" /> Edit Cover
                    </Link>
                    <Link href="/account" aria-label="More options" className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/40 text-white backdrop-blur-md transition hover:bg-black/55">
                      <MoreHorizontal className="h-5 w-5" />
                    </Link>
                  </div>
                </div>

                {/* Identity Card™ — the premium glass surface */}
                <div className="relative z-10 px-3 sm:px-4">
                  <div className="relative glass-strong -mt-10 rounded-3xl px-4 pb-6 pt-0 sm:-mt-14 sm:px-7">
                    {/* Profile accent (Part · Appearance) — a subtle "your colour" tab. */}
                    {heroAccent ? <span aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-1.5 w-24 -translate-x-1/2 rounded-b-full" style={{ background: heroAccent }} /> : null}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="min-w-0">
                        {/* Avatar straddling the cover edge — Identity Ring shows live presence + verification */}
                        <div className="relative -mt-14 w-fit sm:-mt-[4.5rem]">
                    {/* Accent glow — the member's theme colour as a soft halo behind the avatar. */}
                    {heroAccent ? <span aria-hidden className="pointer-events-none absolute -inset-2.5 rounded-full opacity-50 blur-xl" style={{ background: heroAccent }} /> : null}
                          <IdentityRing userId={profile.id} verified={profile.isVerified} premium={plan !== "free"}>
                            <IdentityMediaViewer
                              mode={profileMedia.identityMode}
                              photo={profile.avatarUrl}
                              video={profileMedia.videoUrl}
                              avatar={profileMedia.avatarUrl}
                              name={profile.displayName}
                            >
                              <IdentityMedia
                                mode={profileMedia.identityMode}
                                photo={profile.avatarUrl}
                                video={profileMedia.videoUrl}
                                avatar={profileMedia.avatarUrl}
                                name={profile.displayName}
                                className="h-24 w-24 ring-4 ring-background sm:h-28 sm:w-28"
                              />
                            </IdentityMediaViewer>
                          </IdentityRing>
                          <Link href="/account/identity" aria-label="Change photo" className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-card text-foreground shadow-md ring-1 ring-border transition hover:bg-secondary">
                            <Camera className="h-4 w-4" />
                          </Link>
                        </div>

                        {/* Identity mode — Photo is live; Video & Avatar arrive with the
                            media pipeline and Avatar Studio (marked, never faked). */}
                        {/* Identity mode — reflects the active mode; tap to set it up in Settings. */}
                        <div className="mt-3 inline-flex items-center gap-1 rounded-2xl border border-border/60 bg-card/60 p-1 backdrop-blur">
                          {(["photo", "video", "avatar"] as const).map((m) => (
                            <Link
                              key={m}
                              href="/account/identity"
                              aria-current={profileMedia.identityMode === m ? "true" : undefined}
                              className={`rounded-xl px-3 py-1.5 text-xs capitalize transition ${
                                profileMedia.identityMode === m
                                  ? "bg-brand font-bold text-white"
                                  : "font-semibold text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {m}
                            </Link>
                          ))}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-1 sm:pt-0">
                        <Link href="/account/identity" className="btn-lux btn-lux-secondary">
                          Edit Profile
                        </Link>
                        <ShareProfileButton handle={profile.handle} name={profile.displayName} />
                      </div>
                    </div>

                    {/* Name + trust badges */}
                    <div className="mt-4">
                      <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
                        {profile.displayName}
                        {profile.isVerified ? <BadgeCheck className="h-6 w-6 fill-blue-500 text-white" /> : null}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${heroAccent ? "" : "bg-violet-500/12 text-violet-600 dark:text-violet-300"}`}
                          style={heroAccent ? { backgroundColor: `${heroAccent}1f`, color: heroAccent } : undefined}
                        >
                          <Sparkles className="h-3.5 w-3.5" /> Creator
                        </span>
                      </h1>
                      <p className="mt-0.5 text-muted-foreground">@{profile.handle}</p>
                      {/* Status + Mood (Part 9) — read defensively; empty until migration 0095 applies. */}
                      {profileExtras.status || profileExtras.mood ? (
                        <div className="mt-2 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-full bg-secondary/60 px-3 py-1 text-sm">
                          {profileExtras.mood ? <span className="font-semibold text-primary" style={heroAccent ? { color: heroAccent } : undefined}>{profileExtras.mood}</span> : null}
                          {profileExtras.status ? <span className="text-muted-foreground">{profileExtras.status}</span> : null}
                        </div>
                      ) : null}
                    </div>

                    {profile.bio ? <p className="mt-3 max-w-2xl leading-relaxed">{profile.bio}</p> : null}

                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                      {profile.website ? (
                        <a href={profile.website} target="_blank" rel="nofollow noopener" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                          <LinkIcon className="h-4 w-4" />
                          {profile.website.replace(/^https?:\/\//, "")}
                        </a>
                      ) : null}
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="h-4 w-4" />
                        {joined}
                      </span>
                    </div>

                    {/* 5 live stats — one divided glass panel; Followers/Following link through */}
                    <div className="mt-5 grid grid-cols-5 divide-x divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-card/50 ring-hairline">
                      {stats.map((s) => {
                        const href =
                          s.label === "Followers"
                            ? `/u/${profile.handle}/followers`
                            : s.label === "Following"
                              ? `/u/${profile.handle}/following`
                              : null;
                        const inner = (
                          <>
                            <span className="block text-base font-extrabold tracking-tight sm:text-2xl">{formatCompactNumber(s.value)}</span>
                            <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground sm:text-[11px]">{s.label}</span>
                          </>
                        );
                        return href ? (
                          <Link key={s.label} href={href} className="px-1 py-4 text-center transition hover:bg-secondary/40">
                            {inner}
                          </Link>
                        ) : (
                          <div key={s.label} className="px-1 py-4 text-center">
                            {inner}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Real posts — Videos / Reels / Liked / Saved / Collections (grid + list) */}
                <div className="mt-6 px-4 sm:px-6">
                  <Suspense fallback={<PostGridSkeleton count={6} />}>
                    <ProfileTabsLoader profileId={profile.id} handle={profile.handle} viewerId={me} isOwner tabs={tabs} initialTab={activeTab} />
                  </Suspense>
                </div>
              </div>
            </div>

              <CreatorRail
                className="frenz-profile-rail"
                bio={profile.bio}
                website={profile.website}
                joined={joined}
                friends={friends}
                activity={activity}
                achievements={achievements}
                analytics={{ views: totals.views, likes: totals.likes, comments: totals.comments, shares: totals.shares, saves: totals.saves }}
                topContent={totals.topPost}
                reputation={reputation}
                journey={journey}
              />
            </div>
          </div>
        </main>
        <Toaster />
      </>
    );
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      {/* Mobile top bar — desktop uses the app shell's sidebar + top bar */}
      <SiteHeader social desktopHidden />
      {/* Add friends — single top-level icon (mobile only; desktop uses the top bar) */}
      <SuggestionsLauncher className="fixed left-3 top-[calc(0.75rem+var(--frenz-safe-top))] z-[60] bg-background/70 backdrop-blur-xl lg:hidden" />
      <main className="pb-24 pt-14 sm:pt-16 lg:pt-4">
        <div className="mx-auto flex w-full max-w-6xl gap-6">
          <div className="mx-auto min-w-0 max-w-4xl flex-1 sm:px-4">
          {/* Hero — cover + glass Identity Card + Identity Presence™ (Profile Header · Part 2).
              The same premium surface as the owner hero, now for visitors, with real
              relationship signals (friends / follows-you / following / mutuals) — never faked. */}
          <div className="relative">
            {/* Cover — Living Profile light or the member's own banner */}
            <div className="relative h-44 w-full overflow-hidden bg-gradient-to-br from-blue-600/30 via-violet-500/15 to-purple-500/20 sm:h-60 sm:rounded-3xl md:h-64">
              {profile.bannerUrl ? (
                <Image src={profile.bannerUrl} alt="" fill priority sizes="(max-width: 896px) 100vw, 896px" className="object-cover" />
              ) : null}
              <LivingGlow joinedAt={profile.createdAt} />
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/25" />
            </div>

            {/* Identity Card™ — the premium glass surface */}
            <div className="relative z-10 px-3 sm:px-4">
              <div className="relative glass-strong -mt-10 rounded-3xl px-4 pb-6 pt-0 sm:-mt-14 sm:px-7">
                {/* Profile accent (Part · Appearance) — a subtle "your colour" tab. */}
                {heroAccent ? <span aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-1.5 w-24 -translate-x-1/2 rounded-b-full" style={{ background: heroAccent }} /> : null}
                {/* Avatar + adaptive action bar */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="relative -mt-14 w-fit sm:-mt-[4.5rem]">
                    {/* Accent glow — the member's theme colour as a soft halo behind the avatar. */}
                    {heroAccent ? <span aria-hidden className="pointer-events-none absolute -inset-2.5 rounded-full opacity-50 blur-xl" style={{ background: heroAccent }} /> : null}
                    <IdentityRing userId={profile.id} verified={profile.isVerified} premium={plan !== "free"}>
                      <IdentityMediaViewer
                        mode={profileMedia.identityMode}
                        photo={profile.avatarUrl}
                        video={profileMedia.videoUrl}
                        avatar={profileMedia.avatarUrl}
                        name={profile.displayName}
                      >
                        <IdentityMedia
                          mode={profileMedia.identityMode}
                          photo={profile.avatarUrl}
                          video={profileMedia.videoUrl}
                          avatar={profileMedia.avatarUrl}
                          name={profile.displayName}
                          className="h-24 w-24 ring-4 ring-background sm:h-32 sm:w-32"
                        />
                      </IdentityMediaViewer>
                    </IdentityRing>
                    <DiamondCrownBadge plan={plan} size="md" className="absolute bottom-1 right-1 z-10 ring-2 ring-background" />
                  </div>

                  {/* Action bar — every button always visible, no scrolling on any
                      device: it wraps to a second row on narrow screens rather than
                      scrolling sideways (which also clipped the ••• menu). */}
                  <div className="flex flex-wrap items-center gap-2 sm:mb-1 sm:justify-end">
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
                      followsYou={followsYou}
                      className="shrink-0"
                    />
                    {me ? (
                      <>
                        {/* Adaptive Relationship Engine (Part 7): messaging a friend is
                            the natural primary action, so Message leads (filled) between
                            friends and stays a calm secondary otherwise. */}
                        <Link
                          href={`/messages/new/${profile.id}`}
                          className={`btn-lux shrink-0 ${friendState === "friends" ? "btn-lux-primary" : "btn-lux-secondary"}`}
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
                  </div>
                </div>

                {/* Identity */}
                <div className="mt-4">
                  <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
                    {profile.displayName}
                    {profile.isVerified ? <BadgeCheck className="h-5 w-5 text-primary sm:h-6 sm:w-6" /> : null}
                    <DiamondCrownBadge plan={plan} size="sm" showLabel />
                  </h1>
                  <p className="mt-0.5 text-muted-foreground">@{profile.handle}</p>
                  {/* Status + Mood (Part 9) — the member's own expression, read
                      defensively so it stays empty until migration 0095 is applied. */}
                  {profileExtras.status || profileExtras.mood ? (
                    <div className="mt-2 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-full bg-secondary/60 px-3 py-1 text-sm">
                      {profileExtras.mood ? <span className="font-semibold text-primary" style={heroAccent ? { color: heroAccent } : undefined}>{profileExtras.mood}</span> : null}
                      {profileExtras.status ? <span className="text-muted-foreground">{profileExtras.status}</span> : null}
                    </div>
                  ) : null}
                </div>

                {/* Identity Presence™ — independent relationship signals, real data only.
                    Rendered only for signed-in visitors when a genuine relationship exists. */}
                {isViewer &&
                (friendState === "friends" ||
                  friendState === "incoming" ||
                  friendState === "outgoing" ||
                  followsYou ||
                  profile.isFollowing ||
                  mutuals > 0) ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {friendState === "friends" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Friends
                      </span>
                    ) : friendState === "incoming" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/12 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Sent you a request
                      </span>
                    ) : friendState === "outgoing" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" /> Request sent
                      </span>
                    ) : null}
                    {followsYou ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/12 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-blue-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Follows you
                      </span>
                    ) : null}
                    {profile.isFollowing ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                        <BadgeCheck className="h-3.5 w-3.5" /> Following
                      </span>
                    ) : null}
                    {mutuals > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-gradient-to-r from-blue-500/15 to-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-600 dark:text-violet-300">
                        {mutuals} mutual friend{mutuals === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {profile.restricted ? (
                  <div className="mt-6 rounded-2xl border border-border/60 bg-card/50 p-8 text-center ring-hairline">
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

                    {/* Live stats — divided glass panel; Following/Followers link through */}
                    <div className="mt-5 grid grid-cols-4 divide-x divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-card/50 ring-hairline">
                      <Link
                        href={`/u/${profile.handle}/following`}
                        className="px-2 py-4 text-center transition hover:bg-secondary/40 sm:py-5"
                      >
                        <span className="block text-xl font-bold tracking-tight sm:text-2xl">{formatCompactNumber(profile.followingCount)}</span>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-[11px]">Following</span>
                      </Link>
                      <Link
                        href={`/u/${profile.handle}/followers`}
                        className="px-2 py-4 text-center transition hover:bg-secondary/40 sm:py-5"
                      >
                        <span className="block text-xl font-bold tracking-tight sm:text-2xl">{formatCompactNumber(profile.followersCount)}</span>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-[11px]">Followers</span>
                      </Link>
                      <div className="px-2 py-4 text-center sm:py-5">
                        <span className="block text-xl font-bold tracking-tight sm:text-2xl">{formatCompactNumber(friendTotal)}</span>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-[11px]">Friends</span>
                      </div>
                      <div className="px-2 py-4 text-center sm:py-5">
                        <span className="block text-xl font-bold tracking-tight sm:text-2xl">{formatCompactNumber(postsTotal)}</span>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-[11px]">Posts</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Content tabs — fetched once, switched instantly client-side. Hidden for private accounts. */}
            {!profile.restricted ? (
              <div className="mt-6 px-4 sm:px-6">
                <Suspense fallback={<PostGridSkeleton count={6} />}>
                  <ProfileTabsLoader
                    profileId={profile.id}
                    handle={profile.handle}
                    viewerId={me}
                    isOwner={profile.isOwner}
                    tabs={tabs}
                    initialTab={activeTab}
                  />
                </Suspense>
              </div>
            ) : null}
          </div>
          </div>
          {/* Owner feature panel — docked open on desktop, a toggle drawer on mobile */}
          {profile.isOwner ? <ProfileMenu /> : null}
        </div>
      </main>
    </>
  );
}

/** Fetches every tab's dataset ONCE (behind Suspense), then hands them to the
 *  instant client-side tabs. Posts/Reels/Downloads all derive from one query. */
async function ProfileTabsLoader({
  profileId,
  handle,
  viewerId,
  isOwner,
  tabs,
  initialTab,
}: {
  profileId: string;
  handle: string;
  viewerId: string | null;
  isOwner: boolean;
  tabs: ProfileTab[];
  initialTab: ProfileTab;
}) {
  // Only fetch a tab's dataset when it's actually visible to this viewer — a
  // hidden (private) tab never even loads its data, so nothing can leak.
  const [posts, liked, saved, reposted, jar] = await Promise.all([
    listUserPosts(profileId, viewerId),
    tabs.includes("liked") ? listLikedPosts(profileId) : Promise.resolve([]),
    tabs.includes("saved") ? listSavedPosts(profileId) : Promise.resolve([]),
    tabs.includes("reposted") ? listUserReposts(profileId) : Promise.resolve([]),
    cookies(),
  ]);
  // Seed the grid/list choice from the cookie so the layout paints instantly.
  const initialView = jar.get("svd_profile_view")?.value === "list" ? "list" : "grid";

  return (
    <ProfileTabs
      handle={handle}
      ownerId={profileId}
      isOwner={isOwner}
      tabs={tabs}
      initialTab={initialTab}
      initialView={initialView}
      posts={posts}
      liked={liked}
      saved={saved}
      reposted={reposted}
    />
  );
}

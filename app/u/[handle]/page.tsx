import { ProfileHighlightsLoader } from "@/features/profile/profile-highlights-loader";
import {
  BadgeCheck,
  CalendarDays,
  Camera,
  Eye,
  Grid3x3,
  Heart,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import Link from "next/link";
import { guestVisitorKey, recordProfileVisit } from "@/lib/sub/visits";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { IdentityBadges } from "@/components/badges/identity-badges";
import { PageLoaderWithHeader } from "@/features/ui/page-loader";
import { RankCrown } from "@/components/badges/rank-crown";
import { jsonLd } from "@/lib/seo/json-ld";
import { ProfileSections } from "@/features/profile/profile-sections";
import { PROFILE_PRIMARY_BUTTON, PROFILE_SECONDARY_BUTTON, ProfileActionRow, ProfileCover, ProfileIdentity, ProfileStats } from "@/features/profile/profile-hero";
import { StreakHeaderChip } from "@/features/streaks/streak-header-chip";
import { AddFriendButton } from "@/features/friends/add-friend-button";
import { IdentityRing } from "@/features/profile/identity-ring";
import { viewerCircleIds } from "@/lib/social/graph/store";
import { ProfileCoverControls } from "@/features/profile/profile-cover-controls";
import { Toaster } from "@/features/ui/toast";
import { ProfileCardLink } from "@/features/profile/profile-card-link";
import { ShareProfileButton } from "@/features/profile/share-profile-button";
import { CreatorNotificationsButton } from "@/features/social/creator-notifications-button";
import { CreatorNotifyNudgeHost } from "@/features/social/creator-notify-nudge";
import { FollowButton } from "@/features/social/follow-button";
import { ProfileActions } from "@/features/social/profile-actions";
import { PostGridSkeleton } from "@/features/ui/page-skeletons";
import { getUserPlan } from "@/lib/monetization/plan";
import { friendsCount, friendshipState, mutualFriendsCount } from "@/lib/social/friends";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewableCollectionsCount } from "@/lib/social/collections";
import { existingDirectConversationId } from "@/lib/social/messages";
import { listLikedPosts, listSavedPosts, listUserPosts, listUserReposts } from "@/lib/social/posts";
import { accentHex, getPrivacySettings, getProfileExtras, getProfileMedia, getPublicProfile, getReputationBonus, tabVisible } from "@/lib/social/profile";
import { IdentityMedia } from "@/features/profile/identity-media";
import { IdentityMediaViewer } from "@/features/profile/identity-media-viewer";
import { computeReputation } from "@/lib/social/reputation";
import { resolveProfileTheme } from "@/lib/profile/theme";
import { creatorTotals, publishedPostsCount } from "@/lib/profile/hub-data";
import { getProfileAppearance } from "@/lib/social/profile-appearance";
import { computeAchievements } from "@/lib/social/achievements";
import { isPreviewableRole, resolveViewerRole, type ViewerRole } from "@/lib/profile/audience";
import type { StoredModule } from "@/lib/profile/engine";
import type { ModuleKey } from "@/lib/profile/modules";
import { isCommercialType, profileType, type ProfileTypeKey } from "@/lib/profile/profile-types";
import type { EarnedAchievement } from "@/lib/social/achievements";
import {
  getProfileDetails,
  getProfileIdentity,
  getProfileModules,
  listCredentials,
  listOfferings,
  type Credential,
  type Offering,
  type ProfileDetails,
} from "@/lib/social/profile-platform";
import { createClient } from "@/lib/supabase/server";
import { subTabFor } from "@/lib/sub/profile";
import { profilePath } from "@/lib/social/profile-url";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * The signed-in member's own Profile Health (Part 15).
 *
 * Deliberately re-reads the session user rather than taking an id: the health
 * score depends on auth-only facts (email confirmation, verified MFA factors)
 * that live on the session and cannot be derived from a profile row. Returns
 * undefined on any failure — the rail simply drops the card.
 */
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
  return {
    title: `${profile.displayName} (@${profile.handle})`,
    description: profile.bio ?? `${profile.displayName} on FrenzSave.`,
    alternates: { canonical: profilePath(profile.handle) },
    // app-only since 2026-10-29 (lib/auth/app-only-paths.ts): profiles are signed-in surfaces and never indexed
    robots: { index: false, follow: false },
    openGraph: {
      type: "profile",
      // the canonical /:handle (2026-10-17) — share previews and crawlers see the new form
      url: profilePath(profile.handle),
      title: `${profile.displayName} (@${profile.handle})`,
      description: profile.bio ?? `${profile.displayName} on FrenzSave.`,
      images: profile.avatarUrl ? [{ url: profile.avatarUrl }] : undefined,
    },
  };
}

/**
 * The stat row's icons (lux brief, 2026-08-04).
 *
 * Colour lands on the GLYPH only — the number stays black, which is what keeps
 * the row readable as data rather than as decoration. Each stat gets its own
 * hue so the row is scannable at a glance without any of them shouting; Likes
 * is the one gradient, because it is the only stat with two owners (the person
 * and the people who gave it).
 */


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

/*
  🔴 Synchronous shell, streamed data — the cold-entry white-screen fix
  (owner, 2026-08-11). This awaited params, the viewer, the profile and then
  eleven parallel queries at the TOP LEVEL, so on a cold document request Next
  held the entire HTML response and the visitor saw white. The mobile header for
  this section lives in the PAGE, not the shell, so the fallback draws the
  matching bar itself — the same PageLoaderWithHeader this route's loading.tsx
  already uses, which is why a cold entry and an in-app navigation now look
  identical. See app/(app)/home/page.tsx for the full reasoning.
*/
export default function ProfilePage(props: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ tab?: string; preview?: string }>;
}) {
  return (
    <Suspense fallback={<PageLoaderWithHeader />}>
      <ProfileData {...props} />
    </Suspense>
  );
}

async function ProfileData({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ tab?: string; preview?: string }>;
}) {
  const [{ handle }, { tab, preview }] = await Promise.all([params, searchParams]);
  const me = await viewerId();
  const profile = await getPublicProfile(handle, me);
  if (!profile) notFound();

  // 0265: one visit per visitor per day for the owner's Earnings & analytics — after the page is sent, never
  // slowing it; a guest is a daily one-way hash, never an address (lib/sub/visits.ts)
  if (!profile.isOwner) {
    const h = await headers();
    const guestKey = me ? null : guestVisitorKey(h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), h.get("user-agent"));
    after(() => recordProfileVisit(profile.id, me, guestKey));
  }

  // The profile header renders immediately; the (heavier) posts grid streams in
  // behind a skeleton so the page never blocks on the post query.
  const isViewer = !!me && !profile.isOwner;
  /*
    ── 🔴 ONE WAVE, NOT FOUR (owner, 2026-09-13: "the profile page takes time
    to open on cold entry") ────────────────────────────────────────────────

    After this wave the page used to `await getProfileMedia`, then
    `await getProfileAppearance`, then a second `Promise.all` of the five
    profile-engine reads — three more round trips to Supabase in sequence,
    each waiting on the one before for no reason: every one of them needs
    only `profile.id`, which is known here. On a cold lambda from cdg1 that
    was three extra network hops before a byte of HTML. They are in this one
    wave now; the owner-only wave further down still depends on `me`.
  */
  const [
    plan,
    friendState,
    mutuals,
    friendTotal,
    postsTotal,
    privacy,
    collectionsN,
    followsYou,
    profileExtras,
    totals,
    repBonus,
    profileMedia,
    appearance,
    identity,
    storedModules,
    details,
    credentials,
    offerings,
    directChatId,
  ] = await Promise.all([
    getUserPlan(profile.id),
    isViewer ? friendshipState(me!, profile.id) : Promise.resolve("none" as const),
    isViewer ? mutualFriendsCount(me!, profile.id) : Promise.resolve(0),
    friendsCount(profile.id),
    publishedPostsCount(profile.id, profile.isOwner),
    getPrivacySettings(profile.id),
    viewableCollectionsCount(profile.id, me, profile.isFollowing),
    isViewer ? followsViewer(profile.id, me!) : Promise.resolve(false),
    getProfileExtras(profile.id),
    // Hoisted from the owner branch so the PUBLIC reputation chip (migration 0102)
    // can use the same real totals — reputation is shown publicly by default.
    creatorTotals(profile.id),
    getReputationBonus(profile.id),
    // Digital Identity media (migration 0098) — the identity the profile displays.
    getProfileMedia(profile.id),
    // The Layout Studio theme (see the note below where it is resolved).
    getProfileAppearance(profile.id),
    // Universal Profile Engine™ (Feature 18 · Part 14, migration 0107) — what
    // this profile IS, which sections it offers, and the content those
    // sections read. Every reader degrades to empty/defaults.
    getProfileIdentity(profile.id),
    getProfileModules(profile.id),
    getProfileDetails(profile.id),
    listCredentials(profile.id),
    listOfferings(profile.id),
    // Message opens an existing chat directly (owner, 2026-10-08) — no get-or-create redirect
    isViewer ? existingDirectConversationId(me!, profile.id) : Promise.resolve(null),
  ]);
  /*
    ── The Layout Studio theme now reaches the profile ─────────────────────
    Owner (2026-08-04): "the profile layout settings doesn't change how the
    profile card looks."

    They were right, and the cause was narrow. `resolveProfileTheme` emits
    three kinds of variable — surface/radius (wired to every card), an ACCENT,
    and a background WASH — but the accent and the wash were consumed in
    exactly one place: the Layout Studio's own preview pane. So the preview
    changed and the profile did not, which is worse than the feature not
    existing: the settings screen was demonstrating something untrue.

    The hero accent now comes from the RESOLVED theme rather than from the
    member's separate accent column. `resolveProfileTheme` already prefers a
    member's own accent (migration 0096) and falls back to the theme's, with
    the WCAG correction from Part 16 applied — so picking a theme finally
    changes the card, and picking an accent still wins over it.
  */
  const theme = resolveProfileTheme({ ...appearance, accent: accentHex(profileExtras.accent) });
  /*
    ── 🔴 NO ACCENT BY DEFAULT (owner, 2026-09-13) ─────────────────────────

    "Make profile default accent colour to be no colour and not blue; it
    should be plain white on default, and all new accounts should be created
    as default white."

    `resolveProfileTheme` always answers WITH a colour — the classic theme's
    electric blue when nothing is stored — and this used to be read straight
    into the frame line, the avatar ring, the mood colour and the badges. So
    every new account wore blue it never chose. The colour is now only taken
    when the member has actually chosen something: their own accent (0096)
    wins, then the accent of a theme they picked in the Layout Studio, and
    with neither stored there is no accent at all. Nothing is written to the
    database for this: a new account's `accent` and `theme` are already
    null, which is what "default white" reads as here.
  */
  const heroAccent: string | null = accentHex(profileExtras.accent) ?? (appearance.theme ? theme.accent : null);
  /*
    ── 🔴 THE HERO CARD HAS NO SHADOW ANY MORE (owner, 2026-09-13) ───────────

    "Remove the shadow from the profile hero card and make it lap on top."

    Until now the accent wrapped the Identity Card as a glowing stripe PLUS
    three shadows — the glass base shadow, a soft accent glow and an
    accent-tinted drop shadow (owner, earlier: "like a stripe premium luxury
    glow and shadow"). Every shadow layer is gone. What survives is the
    frame: one 1.5px line in the member's accent, which is the "colour set by
    the user" the same day's instruction names for the avatar ring too. With
    no accent the card gets `box-shadow: none` explicitly, because `.lux-card`
    carries its own default shadow and an undefined style would leave it on.

    The card also laps FURTHER over the cover (`-mt-16 sm:-mt-20`, was
    `-mt-10 sm:-mt-14`) — flat on top of the artwork like a sheet, which is
    how a card with no drop shadow reads as sitting on something rather than
    floating above it.
  */

  // Reputation — computed from real signals (no fabrication; see reputation.ts),
  // in the shared scope so both the owner's rail and the PUBLIC reputation chip use
  // the same value. Shown publicly by default; the profile owner can hide the public
  // chip via privacy (`show_reputation`), and always sees their own in the rail.
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

  // ── Universal Profile Engine™ (Feature 18 · Part 14, migration 0107) ──────
  // The five reads joined the first wave above; before 0107 is applied the
  // engine simply resolves every profile as a personal profile with its
  // default sections — today's behaviour exactly.
  const typeSpec = profileType(identity.type);

  // Visitor Adaptive Experience™ — the viewer's role is DERIVED from real
  // relationships, never claimed. `isAdmin` is deliberately not resolved here:
  // moderators get no elevated access to a member's sections (see audience.ts),
  // so establishing it would cost a query and change nothing.
  const realRole = resolveViewerRole({
    viewerId: me,
    isOwner: profile.isOwner,
    isAdmin: false,
    isFriend: friendState === "friends",
    isFollowing: profile.isFollowing,
  });

  /*
    Profile Preview (Part 16). `?preview=<role>` renders your OWN profile as
    someone else sees it, by feeding the role into the real resolver rather than
    simulating anything — so the preview cannot drift from what a visitor gets.

    It only applies to the owner, and only for `PREVIEWABLE_ROLES` (which
    excludes owner and admin), so it can only ever REDUCE what is rendered.
    There is no value of `?preview=` that reveals more than the viewer is
    already entitled to, which is what keeps it out of the access-control story.
  */
  const previewRole =
    profile.isOwner && preview && isPreviewableRole(preview) ? (preview as ViewerRole) : null;
  const viewerRole = previewRole ?? realRole;

  // Reposts / Wows / Saved keep answering to their OWN per-tab privacy setting
  // (Repost spec §7). The engine may narrow them further, never widen them.
  const allowedGoverned: ModuleKey[] = [];
  if (tabVisible(privacy.reposts_visibility, profile.isOwner, profile.isFollowing)) allowedGoverned.push("reposted");
  if (tabVisible(privacy.likes_visibility, profile.isOwner, profile.isFollowing)) allowedGoverned.push("liked");
  if (tabVisible(privacy.saves_visibility, profile.isOwner, profile.isFollowing)) allowedGoverned.push("saved");

  const joined = `Joined ${new Date(profile.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`;

  // Achievements are derived from the same real signals as reputation. Hoisted
  // out of the owner branch because they are now a SECTION any viewer may be
  // shown (when the member enables it), not just a card in the owner's rail.
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

  const ld = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: `${SITE_URL}${profilePath(profile.handle)}`,
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
    /*
      🔴 NOTHING ELSE IS READ FOR THE OWNER (owner, 2026-09-13: "The profile
      page should be extremely light"). Top friends, twelve notifications,
      the first post, the time capsules, the journal and the health score
      used to be six more awaited reads here, streamed into the document as
      cards under the grid. They are hub sections now — read by
      /api/profile/<handle>/hub/<key> when their button scrolls into view or
      is tapped (lib/profile/hub-data.ts) — and this branch renders the
      hero, the mode switcher, the grid and the buttons.
    */
    /*
      🔴 VIEWS DROPPED FROM THE HERO ROW (owner, 2026-08-16: "let the profile
      post view be showed only in profile analysis, and not in profile
      Hero"). It stayed doubled up: this row AND `CreatorRail`'s Analytics
      panel below both showed the same `totals.views` number. Analytics is
      the one place it lives now — `analytics={{ views: totals.views, … }}`
      a few lines down still passes it there unchanged.
    */
    const stats: { label: string; value: number }[] = [
      { label: "Posts", value: postsTotal },
      { label: "Followers", value: profile.followersCount },
      { label: "Following", value: profile.followingCount },
      { label: "Likes", value: totals.likes },
    ];
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
        {/* No fixed top bar on mobile any more (owner) — the cover runs edge to
            edge under the status bar and its controls float over it. */}
        <main className="frenz-lux frenz-profile-scale bg-frenz-page pb-24 pt-0 lg:pt-4" style={theme.vars as React.CSSProperties}>
          {/* `frenz-profile-shell/cols/rail` (globals.css) put the rail beside
              the center only when the wrapper's OWN width — inside the app
              sidebar — passes 62rem, so it never clips on a laptop. */}
          <div className="frenz-profile-shell mx-auto w-full max-w-7xl px-0 sm:px-4">
            <div className="frenz-profile-cols flex flex-col gap-6">
              <div className="min-w-0 flex-1">
              {/*
                The design's hero (design/Profile.dc.html, 2026-10-18) — shared with the visitor view
                (features/profile/profile-hero.tsx). The avatar keeps its identity frame (gold for a
                paid plan, the member's accent) and its Photo / Video / Avatar media; the mode is
                changed from the camera button, which opens Identity.
              */}
              <div className="relative">
                <ProfileCover bannerUrl={profile.bannerUrl} joinedAt={profile.createdAt}>
                  <ProfileCoverControls
                    user={{
                      handle: profile.handle,
                      displayName: profile.displayName,
                      avatarUrl: profile.avatarUrl,
                      plan,
                      verified: profile.isVerified,
                    }}
                  />
                  {/* Desktop keeps a plain Edit Cover — the floating controls are the mobile chrome. */}
                  <Link
                    href="/account/identity"
                    className="absolute bottom-3.5 right-4 hidden h-9 items-center gap-1.5 rounded-full border border-white/30 bg-black/45 px-3 text-[13px] font-bold text-white backdrop-blur-md transition hover:bg-black/55 lg:inline-flex"
                  >
                    <Camera className="h-4 w-4" /> Edit cover
                  </Link>
                </ProfileCover>

                <ProfileIdentity
                  avatar={
                    <div className="relative w-fit">
                      <IdentityRing userId={profile.id} verified={profile.isVerified} premium={plan !== "free"} accent={heroAccent} glow={false} presence={false}>
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
                            className="h-[100px] w-[100px] ring-[3px] ring-frenz-page"
                          />
                        </IdentityMediaViewer>
                      </IdentityRing>
                      <Link
                        href="/account/identity"
                        aria-label="Change photo"
                        className="absolute -right-0.5 bottom-0.5 flex h-[34px] w-[34px] items-center justify-center rounded-full border-[3px] border-frenz-page bg-frenz-ink text-white transition active:scale-90"
                      >
                        <Camera className="h-[15px] w-[15px]" strokeWidth={2.4} />
                      </Link>
                    </div>
                  }
                  aside={<StreakHeaderChip variant="pill" />}
                  name={profile.displayName}
                  verified={profile.isVerified}
                  badges={<IdentityBadges verified={false} plan={plan} creator accent={heroAccent} />}
                  handle={profile.handle}
                  typeLabel={identity.type !== "personal" ? typeSpec.label : null}
                  extras={
                    details.headline || profileExtras.status || profileExtras.mood ? (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        {details.headline ? <span className="text-frenz-muted">{details.headline}</span> : null}
                        {profileExtras.mood ? <span className="font-semibold text-frenz-violet" style={heroAccent ? { color: heroAccent } : undefined}>{profileExtras.mood}</span> : null}
                        {profileExtras.status ? <span className="text-frenz-muted">{profileExtras.status}</span> : null}
                      </div>
                    ) : null
                  }
                  bio={profile.bio}
                  website={profile.website}
                  joined={joined}
                />

                <ProfileStats
                  stats={stats.map((s) => ({
                    ...s,
                    href:
                      s.label === "Followers"
                        ? `${profilePath(profile.handle)}/followers`
                        : s.label === "Following"
                          ? `${profilePath(profile.handle)}/following`
                          : undefined,
                  }))}
                />

                <ProfileActionRow>
                  <Link href="/account/identity" className={PROFILE_PRIMARY_BUTTON}>
                    Edit profile
                  </Link>
                  <ShareProfileButton handle={profile.handle} name={profile.displayName} variant="button" />
                  <ProfileCardLink handle={profile.handle} />
                </ProfileActionRow>

                {/* Story highlights (Stories Part 5) — streamed on their own; nothing when there are none */}
                <div className="px-4 sm:px-6">
                  <Suspense fallback={null}>
                    <ProfileHighlightsLoader profileId={profile.id} viewerId={me} />
                  </Suspense>
                </div>

                {/* The daily streak card is a hub section now ("Daily streak"),
                    with the rest of the owner's cards — see ProfileHub. */}

                {/* The sections this profile shows — resolved by the Universal
                    Profile Engine from the member's type, their module choices
                    and (for a visitor) their relationship. */}
                <div className="mt-6 px-4 sm:px-6">
                  <Suspense fallback={<PostGridSkeleton count={6} />}>
                    <ProfileSectionsLoader
                      profileId={profile.id}
                      handle={profile.handle}
                      displayName={profile.displayName}
                      viewerId={me}
                      role={viewerRole}
                      type={identity.type}
                      storedModules={storedModules}
                      landingModule={identity.landingModule}
                      initialTab={tab ?? null}
                      allowedGoverned={allowedGoverned}
                      details={details}
                      credentials={credentials}
                      offerings={offerings}
                      achievements={achievements}
                      website={profile.website}
                      collectionsCount={collectionsN}
                      ownerViewing={profile.isOwner}
                      previewRole={previewRole}
                    />
                  </Suspense>
                </div>
              </div>
            </div>

              {/* The creator rail (About Me · Appearance · Health · Reputation ·
                  Journey · Capsules · Journal · Analytics · Tools · Friends ·
                  Activity) is gone from the document: every card is a hub
                  button now (features/profile/profile-hub.tsx), read on demand. */}
            </div>
          </div>
        </main>
        <Toaster />
        <CreatorNotifyNudgeHost />
      </>
    );
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      {/* No mobile top bar and no add-friends launcher (owner). `SiteHeader social`
          collapsed to `h-0` on mobile, so all it contributed was the hairline
          rule sitting across the top of the cover; the +person button floated
          over the artwork beside the avatar. Both are gone, and the cover is
          genuinely edge to edge. Desktop chrome comes from the app shell. */}
      <main className="frenz-lux frenz-profile-scale bg-frenz-page pb-24 pt-0 lg:pt-4" style={theme.vars as React.CSSProperties}>
        <div className="mx-auto flex w-full max-w-6xl gap-6">
          <div className="mx-auto min-w-0 max-w-4xl flex-1 sm:px-4">
          {/* Hero — cover + glass Identity Card + Identity Presence™ (Profile Header · Part 2).
              The same premium surface as the owner hero, now for visitors, with real
              relationship signals (friends / follows-you / following / mutuals) — never faked. */}
          {/* The design's hero, the same one the owner sees (features/profile/profile-hero.tsx, 2026-10-18).
              Only what a visitor may DO differs: Follow / Message instead of Edit profile. */}
          <div className="relative">
            <ProfileCover bannerUrl={profile.bannerUrl} joinedAt={profile.createdAt} />

            <ProfileIdentity
              avatar={
                <IdentityRing userId={profile.id} verified={profile.isVerified} premium={plan !== "free"} accent={heroAccent} glow={false}>
                  <IdentityMediaViewer mode={profileMedia.identityMode} photo={profile.avatarUrl} video={profileMedia.videoUrl} avatar={profileMedia.avatarUrl} name={profile.displayName}>
                    <IdentityMedia
                      mode={profileMedia.identityMode}
                      photo={profile.avatarUrl}
                      video={profileMedia.videoUrl}
                      avatar={profileMedia.avatarUrl}
                      name={profile.displayName}
                      className="h-[100px] w-[100px] ring-[3px] ring-frenz-page"
                    />
                  </IdentityMediaViewer>
                </IdentityRing>
              }
              name={profile.displayName}
              verified={profile.isVerified}
              /* the plan badge stays behind the member's privacy switch, the seal never does */
              badges={<IdentityBadges verified={false} plan={plan} showPlan={privacy.show_plan_badge} accent={heroAccent} />}
              handle={profile.handle}
              typeLabel={identity.type !== "personal" ? typeSpec.label : null}
              extras={
                details.headline || privacy.show_reputation || profileExtras.status || profileExtras.mood ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                    {details.headline ? <span className="text-frenz-muted">{details.headline}</span> : null}
                    {/* Public reputation rank (0102) — a small badge; the member can hide it from Privacy */}
                    {privacy.show_reputation ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-white ring-1 ring-inset ring-white/20"
                        style={{ backgroundImage: `linear-gradient(135deg, ${reputation.rank.from}, ${reputation.rank.to})` }}
                        title={`Reputation score ${reputation.score.toLocaleString()}`}
                      >
                        <RankCrown className="h-4 w-4" /> {reputation.rank.name}
                      </span>
                    ) : null}
                    {profileExtras.mood ? <span className="font-semibold text-frenz-violet" style={heroAccent ? { color: heroAccent } : undefined}>{profileExtras.mood}</span> : null}
                    {profileExtras.status ? <span className="text-frenz-muted">{profileExtras.status}</span> : null}
                  </div>
                ) : null
              }
              bio={profile.restricted ? null : profile.bio}
              website={profile.restricted ? null : profile.website}
              joined={joined}
            />

            {profile.restricted ? (
              <div className="frenz-ui mx-5 mt-4 rounded-[20px] border border-frenz-line bg-frenz-card p-8 text-center">
                <Lock className="mx-auto h-8 w-8 text-frenz-muted" />
                <p className="mt-3 font-semibold text-frenz-ink">This account is private</p>
                <p className="mt-1 text-sm text-frenz-muted">{me ? "Follow to request access to their activity." : "Sign in and follow to see more."}</p>
              </div>
            ) : null}

                {/* Identity Presence™ — real relationship signals only, signed-in visitors */}
                {isViewer && (friendState === "friends" || friendState === "incoming" || friendState === "outgoing" || followsYou || profile.isFollowing || mutuals > 0) ? (
                  <div className="frenz-ui mx-5 mt-3 flex flex-wrap items-center gap-2">
                    {friendState === "friends" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Friends
                      </span>
                    ) : friendState === "incoming" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Sent you a request
                      </span>
                    ) : friendState === "outgoing" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" /> Request sent
                      </span>
                    ) : null}
                    {followsYou ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-blue-300">
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


            {/* The same four stats, in the same order, as the owner sees (owner 2026-10-16: no views in the visitor hero) */}
            {!profile.restricted ? (
              <ProfileStats
                stats={[
                  { label: "Posts", value: postsTotal },
                  { label: "Followers", value: profile.followersCount, href: `${profilePath(profile.handle)}/followers` },
                  { label: "Following", value: profile.followingCount, href: `${profilePath(profile.handle)}/following` },
                  { label: "Likes", value: totals.likes },
                ]}
              />
            ) : null}

            {/* What a visitor can do: Follow and Message side by side, then share and the profile card */}
            <ProfileActionRow>
              <FollowButton targetId={profile.id} targetHandle={profile.handle} initialFollowing={profile.isFollowing} canFollow={!!me} followsYou={followsYou} variant="frenz" className="h-12 min-w-0 flex-1 justify-center rounded-[14px]" />
              {me ? (
                /* An existing chat opens directly; a first chat goes through /messages/new/ (owner, 2026-10-08) */
                <Link href={directChatId ? `/messages/${directChatId}` : `/messages/new/${profile.id}`} className={PROFILE_SECONDARY_BUTTON}>
                  <MessageCircle className="h-4 w-4" /> Message
                </Link>
              ) : null}
              <ShareProfileButton handle={profile.handle} name={profile.displayName} />
              <ProfileCardLink handle={profile.handle} />
            </ProfileActionRow>
                {/* the rest on its own row, so nothing in the first row is squeezed (owner, 2026-08-16) */}
                {(me && friendState !== "self") || isViewer || (isCommercialType(identity.type) && !profile.restricted && (details.bookingUrl || details.quoteUrl || details.contactPhone || details.contactEmail)) ? (
                  <div className="frenz-ui mx-5 mt-2.5 flex flex-wrap items-center gap-2">
                    {isCommercialType(identity.type) && !profile.restricted ? (
                      <>
                        {details.bookingUrl ? (
                          <a href={details.bookingUrl} target="_blank" rel="nofollow noopener" className="btn-lux btn-lux-primary min-w-0 flex-1 justify-center">
                            <CalendarDays className="h-4 w-4" /> Book
                          </a>
                        ) : null}
                        {details.quoteUrl ? (
                          <a href={details.quoteUrl} target="_blank" rel="nofollow noopener" className="btn-lux btn-lux-secondary min-w-0 flex-1 justify-center">
                            Get a quote
                          </a>
                        ) : null}
                        {details.contactPhone ? (
                          <a href={`tel:${details.contactPhone.replace(/\s/g, "")}`} className="btn-lux btn-lux-secondary min-w-0 flex-1 justify-center">
                            <Phone className="h-4 w-4" /> Call
                          </a>
                        ) : details.contactEmail ? (
                          <a href={`mailto:${details.contactEmail}`} className="btn-lux btn-lux-secondary min-w-0 flex-1 justify-center">
                            <Mail className="h-4 w-4" /> Email
                          </a>
                        ) : null}
                      </>
                    ) : null}
                    {me && friendState !== "self" ? (
                      <AddFriendButton targetId={profile.id} targetName={profile.displayName} targetHandle={profile.handle} targetAvatarUrl={profile.avatarUrl} mutualCount={mutuals} initialState={friendState} className="min-w-0 flex-1 justify-center" />
                    ) : null}
                    {isViewer ? <CreatorNotificationsButton userId={profile.id} handle={profile.handle} /> : null}
                    {me ? <ProfileActions targetId={profile.id} handle={profile.handle} initialBlocked={profile.viewerHasBlocked} /> : null}
                  </div>
                ) : null}


            {/* No streak card here: this is the VISITOR branch, and a streak is
                personal — `useStreak()` reads the viewer's own, which would show
                them their number under someone else's name. It lives in the
                owner branch above. */}
            {/* Content sections — fetched once, switched instantly client-side.
                Hidden entirely for private accounts. */}
            {/* Story highlights (Stories Part 5): whoever may see this member's stories may see these */}
            {!profile.restricted ? (
              <div className="px-4 sm:px-6">
                <Suspense fallback={null}>
                  <ProfileHighlightsLoader profileId={profile.id} viewerId={me} />
                </Suspense>
              </div>
            ) : null}
            {!profile.restricted ? (
              <div className="mt-6 px-4 sm:px-6">
                <Suspense fallback={<PostGridSkeleton count={6} />}>
                  <ProfileSectionsLoader
                    profileId={profile.id}
                    handle={profile.handle}
                    displayName={profile.displayName}
                    viewerId={me}
                    role={viewerRole}
                    type={identity.type}
                    storedModules={storedModules}
                    landingModule={identity.landingModule}
                    initialTab={tab ?? null}
                    allowedGoverned={allowedGoverned}
                    details={details}
                    credentials={credentials}
                    offerings={offerings}
                    achievements={achievements}
                    website={profile.website}
                    collectionsCount={collectionsN}
                      ownerViewing={profile.isOwner}
                      previewRole={previewRole}
                  />
                </Suspense>
              </div>
            ) : null}
          </div>
          </div>
          {/* No owner panel here: this branch only runs when the viewer is NOT
              the owner (see the `if (profile.isOwner)` return above), so the
              `isOwner ?` that used to sit here could never be true. The owner's
              own profile gets the creator rail on desktop and the shared menu
              from the cover controls on mobile. */}
        </div>
      </main>
    </>
  );
}

/**
 * Fetches every post-backed section's dataset ONCE (behind Suspense), then hands
 * everything to the Universal Profile Engine to resolve. Posts / Reels /
 * Downloads all derive from one query.
 */
async function ProfileSectionsLoader({
  profileId,
  handle,
  displayName,
  viewerId,
  role,
  type,
  storedModules,
  landingModule,
  initialTab,
  allowedGoverned,
  details,
  credentials,
  offerings,
  achievements,
  website,
  collectionsCount,
  ownerViewing,
  previewRole,
}: {
  profileId: string;
  handle: string;
  displayName: string;
  viewerId: string | null;
  role: ViewerRole;
  type: ProfileTypeKey;
  storedModules: StoredModule[];
  landingModule: string | null;
  initialTab: string | null;
  allowedGoverned: ModuleKey[];
  details: ProfileDetails;
  credentials: Credential[];
  offerings: Offering[];
  achievements: EarnedAchievement[];
  website: string | null;
  collectionsCount: number;
  ownerViewing: boolean;
  previewRole: ViewerRole | null;
}) {
  const isOwner = role === "owner";
  // Only fetch a section's dataset when this viewer is allowed to see it — a
  // hidden section never even loads its data, so nothing can leak.
  const [posts, liked, saved, reposted, jar, viewerCircles, sub] = await Promise.all([
    // The viewer id is what lets a FOLLOWER see followers-only posts, so it
    // must stay the real viewer — not a stand-in derived from the role.
    /*
      🔴 120, NOT THE DEFAULT 24 (owner, 2026-08-31: "I checked my profile post
      gallery and i saw just a few of what I have posted and many didn't show
      but they show in feed").

      The limit-before-filter bug fixed on 2026-08-30 was real but was only half
      of it: even after that, this asked for TWENTY-FOUR posts and rendered all
      of them, so post 25 onward simply did not exist on the page. Nothing was
      broken — the profile had never been able to show more than 24.

      The tiles are now revealed a page at a time by `PostGrid` (30 per "See
      more"), so a bigger fetch costs one query and no extra DOM: 120 rows of
      post METADATA, no media, behind the existing 30s cache. That is the same
      ceiling `loadUserPosts` already over-fetches to for visibility filtering,
      so it adds no new worst case to the database.
    */
    listUserPosts(profileId, viewerId, 120),
    isOwner || allowedGoverned.includes("liked") ? listLikedPosts(profileId, 120) : Promise.resolve([]),
    isOwner || allowedGoverned.includes("saved") ? listSavedPosts(profileId, 120) : Promise.resolve([]),
    // The viewer id matters here for the same reason it does on `listUserPosts`
    // above: from 0116 an individual repost can be friends-only or private, so
    // the tab being visible is not the same question as each row being visible.
    isOwner || allowedGoverned.includes("reposted") ? listUserReposts(profileId, viewerId, 120) : Promise.resolve([]),
    cookies(),
    // Part 17 — which of THIS owner's circles the viewer is in, so a module
    // gated to "Family" resolves against real membership. Ids only; the viewer
    // never learns a circle's name from a visibility check.
    viewerCircleIds(profileId, viewerId),
    subTabFor(profileId, displayName, viewerId, isOwner && !previewRole),
  ]);
  // Seed the grid/list choice from the cookie so the layout paints instantly.
  const initialView = jar.get("svd_profile_view")?.value === "list" ? "list" : "grid";

  return (
    <ProfileSections
      handle={handle}
      profileId={profileId}
      role={role}
      type={type}
      storedModules={storedModules}
      landingModule={landingModule}
      initialTab={initialTab}
      initialView={initialView}
      posts={posts}
      liked={liked}
      saved={saved}
      reposted={reposted}
      details={details}
      credentials={credentials}
      offerings={offerings}
      achievements={achievements}
      website={website}
      collectionsCount={collectionsCount}
      ownerViewing={ownerViewing}
      previewRole={previewRole}
      allowedGoverned={allowedGoverned}
      viewerCircles={viewerCircles}
      sub={sub}
    />
  );
}


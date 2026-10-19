import {
  Accessibility,
  Activity,
  Award,
  BadgeCheck,
  BarChart3,
  Bell,
  Bookmark,
  Briefcase,
  Code2,
  Compass,
  CreditCard,
  BookHeart,
  Crown,
  Download,
  Ghost,
  KeyRound,
  Layers,
  LayoutGrid,
  Lock,
  Megaphone,
  Palette,
  Search,
  ShieldCheck,
  Star,
  Store,
  UserCog,
  Users,
  LayoutDashboard,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { LanguageSettingRow } from "@/components/i18n/language-setting-row";
import { SettingsBack } from "@/features/account/settings-back";
import { SettingsLink, SettingsList, type SettingsRowSpec } from "@/features/account/settings-list";
import { SettingsSearch } from "@/features/account/settings-search";
import { SitePlanWelcome } from "@/features/account/site-plan-welcome";
import { AppContent } from "@/features/app-shell/app-content";
import { Avatar, VerifiedBadge } from "@/features/frenz-ui/primitives";
import { isAdmin } from "@/lib/admin";
import { BUSINESS_FEATURES, PRO_FEATURES } from "@/lib/monetization/plan-features";
import type { BillingPlan } from "@/lib/monetization/types";
import { effectiveModules } from "@/lib/profile/engine";
import { BAND_LABEL } from "@/lib/profile/health";
import { profileType } from "@/lib/profile/profile-types";
import { profileTheme } from "@/lib/profile/theme";
import { getProfileHealth } from "@/lib/social/profile-health";
import { getOwnProfile } from "@/lib/social/profile";
import { getProfileAppearance } from "@/lib/social/profile-appearance";
import { getProfileIdentity, getProfileModules } from "@/lib/social/profile-platform";
import { GHOST_SIGNALS, ghostedCount, isFullyGhosted, readGhostState } from "@/lib/privacy/ghost";
import { BAND_LABEL as SECURITY_BAND_LABEL, securityScore } from "@/lib/security/score";
import { getSecurityInputs } from "@/lib/security/score-inputs";
import { getOwnPresenceStatus } from "@/lib/social/presence-status";
import { getPrivacySettings } from "@/lib/social/profile";
import { getVerificationState, verificationSummary } from "@/lib/social/verification";
import { getNotificationSettings } from "@/lib/social/notification-settings";
import { createClient } from "@/lib/supabase/server";
import { profilePath } from "@/lib/social/profile-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Row = SettingsRowSpec;

/**
 * Settings — a premium, professional LIST menu (Snapchat/TikTok-style): every
 * category is its OWN page, so nothing is packed on one long scrolling page.
 * Each row is a prefetched <Link>, so opening Settings warms every category and
 * they open instantly with no loading spinner.
 */
export default async function AccountPage() {
  if (!hasSupabase) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: sub }, ownProfile, verification, identity, storedModules] = await Promise.all([
    supabase.from("profiles").select("role, avatar_url, is_verified").eq("id", user.id).single(),
    supabase.from("subscriptions").select("plan, status").eq("user_id", user.id).maybeSingle(),
    getOwnProfile(user.id),
    getVerificationState(user.id),
    getProfileIdentity(user.id),
    getProfileModules(user.id),
  ]);
  const verificationSub = verificationSummary(verification);
  const privacySettings = await getPrivacySettings(user.id);

  // Universal Profile Engine™ — the sub-lines read the member's REAL layout, so
  // the settings list reports what their profile actually is.
  const typeSpec = profileType(identity.type);
  const typeLabelSuffix = identity.type === "personal" ? "your own space" : "switch any time";
  const onCount = effectiveModules(identity.type, storedModules).filter((m) => m.enabled).length;
  const sectionsSub = `${onCount} section${onCount === 1 ? "" : "s"} on your profile`;

  // Layout Studio (Part 16) — the row names the theme actually in use.
  const appearance = await getProfileAppearance(user.id);
  const themeSub = `${profileTheme(appearance.theme).label} theme · cards, corners & text`;

  // Profile Intelligence (Part 15) — the settings row carries the real score, so
  // a member can see where they stand without opening anything.
  const health = await getProfileHealth(user);
  const healthSub =
    health.recommendations.length === 0
      ? `${health.score}/100 · ${BAND_LABEL[health.band]}`
      : `${health.score}/100 · ${health.recommendations.length} suggestion${health.recommendations.length === 1 ? "" : "s"}`;

  /*
    Both rows carry a REAL value rather than a static description — the same
    discipline the Profile health and Layout Studio rows already follow. A
    settings list that tells you where you stand saves opening the screen just
    to find out nothing needs doing.
  */
  const ghostState = readGhostState({
    presenceStatus: await getOwnPresenceStatus(user.id),
    lastSeenVisibility: privacySettings.last_seen_visibility as string | null,
    typingEnabled: privacySettings.typing_indicators_enabled as boolean | null,
    readReceiptsEnabled: privacySettings.read_receipts_enabled as boolean | null,
    activityVisibility: privacySettings.activity_visibility as string | null,
    showViews: privacySettings.show_views as boolean | null,
  });
  const hiddenSignals = ghostedCount(ghostState);
  const ghostSub = isFullyGhosted(ghostState)
    ? "On · every activity signal hidden"
    : hiddenSignals === 0
      ? "Hide your online status, typing and more"
      : `${hiddenSignals} of ${GHOST_SIGNALS.length} signals hidden`;

  const [score, notificationSettings] = await Promise.all([
    getSecurityInputs(user).then(securityScore),
    getNotificationSettings(user.id).catch(() => null),
  ]);
  // fails open to "on": a read error must never show alerts as paused when they are not
  const notificationsOn = notificationSettings?.masterEnabled ?? true;
  const securitySub =
    score.gaps.length === 0
      ? `${score.score}/100 · ${SECURITY_BAND_LABEL[score.band]}`
      : `${score.score}/100 · ${score.gaps.length} to fix`;

  const planActive = sub?.status === "active" || sub?.status === "trialing";
  const plan = (planActive ? sub?.plan : "free") ?? "free";
  const planLabel = plan === "business" ? "Business" : plan === "pro" ? "Pro" : "Free";
  const verified = Boolean(profile?.is_verified);
  const email = user.email ?? "—";
  const avatar = (user.user_metadata?.avatar_url as string | undefined) || profile?.avatar_url || null;
  const admin = isAdmin(profile?.role, user.email);

  /*
    The redesign (design/Settings.dc.html, owner 2026-10-18): two iOS lists first — Profile (Identity,
    Verification, Appearance) and Account (Notifications, Privacy & security, Storage & downloads,
    Language) — each showing its current value on the right. Every other settings page stays, in the
    lists below them: nothing that was reachable from here stops being reachable. Solid tinted icon
    squares with a white glyph, as drawn.
  */
  const typeAccount = `${typeSpec.label} account`;
  const profileRows: Row[] = [
    { href: "/account/identity", Icon: UserCog, title: "Identity", sub: "Name, photo, video, avatar, status", tint: "violet" },
    { href: "/account/verification", Icon: BadgeCheck, title: "Verification", sub: verificationSub, tint: "blue", value: verified ? "Verified" : undefined },
    { href: "/account/appearance", Icon: Palette, title: "Appearance", sub: "Theme, language, home & feed", tint: "purple" },
    // kept here (it was in Profile before the redesign) — not in the design's list, see PROGRESS
    { href: "/account/accessibility", Icon: Accessibility, title: "Accessibility", sub: "Text, contrast, motion & touch", tint: "cyan" },
  ];
  const accountRows: Row[] = [
    { href: "/account/notifications", Icon: Bell, title: "Notifications", sub: "Alerts & activity", tint: "rose", value: notificationsOn ? "On" : "Paused" },
    { href: "/account/security", Icon: ShieldCheck, title: "Privacy & security", sub: securitySub, tint: "emerald" },
    { href: "/downloads", Icon: Download, title: "Storage & downloads", sub: "Your saved library and space used", tint: "blue", value: planLabel },
  ];

  const groups: { heading: string; items: Row[] }[] = [
    {
      // Universal Profile Engine™ (Feature 18 · Part 14) — the type row carries its CURRENT value.
      heading: "Profile platform",
      items: [
        { href: "/account/health", Icon: ShieldCheck, title: "Profile health", sub: healthSub, tint: "emerald" },
        { href: "/account/profile-type", Icon: Layers, title: "Profile type", sub: `${typeSpec.label} · ${typeLabelSuffix}`, tint: "violet" },
        { href: "/account/modules", Icon: LayoutGrid, title: "Sections", sub: sectionsSub, tint: "blue" },
        { href: "/account/layout-studio", Icon: Palette, title: "Layout Studio", sub: themeSub, tint: "purple" },
        { href: "/account/business", Icon: Store, title: "Business", sub: "Overview, contact, hours & catalogue", tint: "emerald" },
        { href: "/account/professional", Icon: Briefcase, title: "Professional", sub: "Portfolio, experience & credentials", tint: "amber" },
        // Feature 19 Part 12: confirmed connections, recommendations, endorsements, opportunities
        { href: "/network", Icon: Users, title: "Professional network", sub: "Connections, recommendations & opportunities", tint: "blue" },
        // Feature 19 Part 13: your community, SUB subscriptions and payouts
        { href: "/members", Icon: Crown, title: "Members", sub: "Your community, and memberships you hold", tint: "violet" },
        // Frenz Exclusive Part 3: every subscribed creator's exclusive posts in one feed
        { href: "/exclusive", Icon: Lock, title: "Exclusive", sub: "Posts from creators you subscribe to", tint: "violet" },
        // Feature 19 Parts 16 and 17: reputation and transparency; the relationship privacy center
        { href: "/account/reputation", Icon: Award, title: "Reputation", sub: "Your standing, badges and every decision explained", tint: "amber" },
        { href: "/account/privacy-center", Icon: ShieldCheck, title: "Privacy Center", sub: "Who can find, reach, mention and remember you", tint: "emerald" },
        // Feature 19 Part 14: shared memories and life journey
        { href: "/memories", Icon: BookHeart, title: "Memories", sub: "Moments you keep, and your life journey", tint: "rose" },
      ],
    },
    {
      heading: "Privacy",
      items: [
        { href: "/account/privacy", Icon: Lock, title: "Privacy", sub: "Who can see & contact you", tint: "emerald" },
        { href: "/account/relationships", Icon: Users, title: "Relationships", sub: "Friend list visibility, circles & trusted contacts", tint: "violet" },
        { href: "/account/discovery", Icon: Search, title: "Discovery", sub: "Who can find you, and by what", tint: "blue" },
        // Feature 19 Part 9: status, focus modes, automations, auto reply and who sees them
        { href: "/account/presence", Icon: Activity, title: "Presence", sub: "Status, focus modes and who sees them", tint: "emerald" },
        { href: "/account/ghost", Icon: Ghost, title: "Ghost Mode", sub: ghostSub, tint: "purple" },
        { href: "/account/password", Icon: KeyRound, title: "Password", sub: "Change your password", tint: "amber" },
      ],
    },
    {
      heading: "Content & insights",
      items: [
        { href: "/saved", Icon: Bookmark, title: "Saved", sub: "Posts you bookmarked", tint: "violet" },
        /* Creator Studio (Feature 15 Part 9) sits ABOVE Analytics deliberately: it is the front door. */
        { href: "/studio", Icon: LayoutDashboard, title: "Creator Studio", sub: "Content, audience, calendar & goals", tint: "amber" },
        { href: "/advertise", Icon: Megaphone, title: "Advertise", sub: "Promote your business on Frenzsave", tint: "rose" },
        { href: "/account/analytics", Icon: BarChart3, title: "Analytics", sub: "Your performance", tint: "emerald" },
        { href: "/account/personalization", Icon: Compass, title: "Discovery & personalization", sub: "Your Frenz DNA, topics & feed controls", tint: "cyan" },
      ],
    },
    {
      heading: "Plan & developer",
      items: [
        { href: "/account/plan", Icon: Crown, title: "Plan", sub: `${planLabel} plan · billing`, tint: "amber" },
        { href: "/exclusive/favourites", Icon: Star, title: "Favourite creators", sub: "Creators you keep one tap away", tint: "amber" },
        { href: "/account/subscriptions", Icon: CreditCard, title: "Subscriptions", sub: "Creators you subscribe to, access dates & receipts", tint: "violet" },
        { href: "/account/developer", Icon: Code2, title: "Developer", sub: "API keys & usage", tint: "slate" },
      ],
    },
  ];

  // the compact profile row — passed into the search island so it hides while a search is showing results
  const profileRow = (
    <Link
      href={ownProfile?.handle ? profilePath(ownProfile.handle) : "/account/identity"}
      prefetch
      className="mt-4 flex items-center gap-3.5 rounded-[22px] border border-frenz-line bg-frenz-card p-3.5 shadow-[0_10px_24px_-20px_rgba(30,20,80,0.4)] transition active:scale-[0.99]"
    >
      <span className="relative shrink-0">
        <Avatar src={avatar} name={ownProfile?.displayName || email} size={62} ring />
        <DiamondCrownBadge plan={plan as BillingPlan} size="sm" className="absolute -bottom-0.5 -right-0.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-heading text-[19px] font-bold">{ownProfile?.displayName || email}</span>
          {verified ? <VerifiedBadge size={17} /> : null}
          {admin ? <span className="shrink-0 rounded-full bg-frenz-violet/10 px-2 py-0.5 text-[11px] font-bold text-frenz-violet">Admin</span> : null}
        </span>
        <span className="truncate text-sm text-frenz-muted">{ownProfile?.handle ? `@${ownProfile.handle} · ${typeAccount}` : email}</span>
      </span>
      <span className="flex h-[34px] shrink-0 items-center rounded-full bg-frenz-fill px-3 text-[13px] font-bold text-frenz-violet">{ownProfile?.handle ? "View" : "Set up"}</span>
    </Link>
  );

  return (
    <AppContent>
      {/* 2026-10-07: the plan welcome + optional survey, for the Frenzsave plans too */}
      <SitePlanWelcome
        plan={plan as "free" | "pro" | "business"}
        benefits={(plan === "business" ? BUSINESS_FEATURES : PRO_FEATURES).filter((l) => !l.startsWith("Everything in"))}
      />
      <div className="frenz-ui mx-auto max-w-2xl text-frenz-ink">
        <header className="px-1">
          <SettingsBack fallback={ownProfile?.handle ? profilePath(ownProfile.handle) : "/home"} />
          <h1 className="m-0 mt-0.5 font-heading text-[32px] font-extrabold tracking-[-1.1px]">Settings</h1>
        </header>

        {/*
          Smart Settings Search + Quick Settings (Feature 18 · Part 21) — the only client island. Search
          runs on the device; the quick tiles carry the real Ghost Mode and notification state read above.
        */}
        <div className="mt-3">
          <SettingsSearch profile={profileRow} ghost={ghostState} notificationsOn={notificationsOn} />
        </div>

        <SettingsList heading="Profile" rows={profileRows} />
        <SettingsList heading="Account" rows={accountRows}>
          <li className="border-t border-frenz-line">
            <LanguageSettingRow variant="list" />
          </li>
        </SettingsList>

        {groups.map((g) => (
          <SettingsList key={g.heading} heading={g.heading} rows={g.items} />
        ))}

        {admin ? (
          <ul className="mt-6 overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card">
            <li>
              <SettingsLink row={{ href: "/admin", Icon: ShieldCheck, title: "Admin dashboard", sub: "Platform controls", tint: "slate" }} />
            </li>
          </ul>
        ) : null}

        <form action="/auth/signout" method="post" className="mt-6 overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card">
          <button type="submit" className="flex h-[54px] w-full items-center justify-center text-base font-bold text-rose-700 dark:text-rose-400">
            Sign out
          </button>
        </form>
        <p className="mt-3.5 text-center text-xs text-frenz-muted">
          Frenzsave{APP_BUILD ? ` · v${APP_BUILD.slice(0, 7)}` : ""} · {email}
        </p>
      </div>
    </AppContent>
  );
}

const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "";

import type { ReactNode } from "react";

import { AchievementsShowcase } from "@/features/profile/achievements-showcase";
import {
  AboutPanel,
  CatalogPanel,
  HoursPanel,
  ResumePanel,
  ShowcasePanel,
  SkillsPanel,
} from "@/features/profile/module-panels";
import { ProfilePreviewBar } from "@/features/profile/preview-bar";
import { ProfileTabs, type ProfileSection } from "@/features/profile/profile-tabs";
import type { ViewerRole } from "@/lib/profile/audience";
import { resolveProfileLayout, type StoredModule } from "@/lib/profile/engine";
import type { ModuleKey } from "@/lib/profile/modules";
import { profileType, type ProfileTypeKey } from "@/lib/profile/profile-types";
import { earnedCount, type EarnedAchievement } from "@/lib/social/achievements";
import type { PostCard } from "@/lib/social/posts";
import {
  credentialsByKind,
  type Credential,
  type Offering,
  type ProfileDetails,
} from "@/lib/social/profile-platform";

/**
 * Universal Profile Engine™ — the render side (Feature 18 · Part 14).
 *
 * Takes everything the page already fetched, asks the engine what THIS viewer
 * should see, and hands the resolved sections to the (client) navigation dock
 * together with each non-post section already rendered on the server.
 *
 * The important property: this is the ONLY place that decides which sections
 * exist, and it is used by the owner branch and the visitor branch alike. The
 * two heroes differ; what a profile can show does not.
 */
export function ProfileSections({
  handle,
  profileId,
  role,
  type,
  storedModules,
  landingModule,
  initialTab,
  initialView,
  posts,
  liked,
  saved,
  reposted,
  details,
  credentials,
  offerings,
  achievements,
  bio,
  website,
  joined,
  collectionsCount,
  ownerViewing = false,
  previewRole = null,
  allowedGoverned,
  viewerCircles,
}: {
  handle: string;
  profileId: string;
  role: ViewerRole;
  type: ProfileTypeKey;
  storedModules: StoredModule[];
  landingModule: string | null;
  initialTab: string | null;
  initialView: "grid" | "list";
  posts: PostCard[];
  liked: PostCard[];
  saved: PostCard[];
  reposted: PostCard[];
  details: ProfileDetails;
  credentials: Credential[];
  offerings: Offering[];
  achievements: EarnedAchievement[];
  bio: string | null;
  website: string | null;
  joined: string;
  collectionsCount: number;
  allowedGoverned: ModuleKey[];
  /** True when the REAL viewer owns this profile — shows the preview bar. */
  ownerViewing?: boolean;
  /** The role being previewed, if any (Part 16). */
  previewRole?: ViewerRole | null;
  /** Owner circles this viewer belongs to (Part 17). Absent = none. */
  viewerCircles?: ReadonlySet<string>;
}) {
  const isOwner = role === "owner";
  const byKind = credentialsByKind(credentials);
  const products = offerings.filter((o) => o.kind === "product");
  const services = offerings.filter((o) => o.kind === "service");
  const spec = profileType(type);

  const hasAbout =
    !!details.headline ||
    !!details.mission ||
    !!bio ||
    !!website ||
    !!details.contactEmail ||
    !!details.contactPhone ||
    !!details.category ||
    details.languages.length > 0;

  // Gate 4 of the engine — SUBSTANCE. Every one of these is a real count, so a
  // visitor is never sent to a section that turns out to be a placeholder.
  const content: Partial<Record<ModuleKey, boolean>> = {
    posts: posts.length > 0,
    reels: posts.some((p) => p.mediaKind === "video"),
    downloads: isOwner || posts.some((p) => p.platform && p.platform !== "frenz"),
    collections: collectionsCount > 0,
    reposted: reposted.length > 0,
    liked: liked.length > 0,
    saved: saved.length > 0,
    about: hasAbout,
    achievements: earnedCount(achievements) > 0,
    portfolio: byKind.project.length > 0,
    experience: byKind.experience.length > 0,
    education: byKind.education.length > 0,
    certifications: byKind.certification.length > 0,
    awards: byKind.award.length > 0,
    publications: byKind.publication.length > 0,
    skills: details.skills.length > 0,
    resume: !!details.resumeUrl,
    catalog: products.length > 0,
    services: services.length > 0,
    hours: details.hours.some((h) => !h.closed) || !!details.address || !!details.city,
  };

  const layout = resolveProfileLayout({
    type,
    stored: storedModules,
    landing: landingModule,
    role,
    content,
    allowedGoverned,
    viewerCircles,
  });

  // The preview bar is owner-only chrome and renders even when the previewed
  // role can see NOTHING — that empty result is the single most useful thing
  // the preview can tell you, so returning null here would hide the answer.
  const previewBar = ownerViewing ? (
    <ProfilePreviewBar handle={handle} active={previewRole} visibleCount={layout.modules.length} />
  ) : null;

  if (layout.modules.length === 0) {
    return previewBar ? (
      <>
        {previewBar}
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing on your profile is visible to {previewRole ? "this audience" : "anyone"} yet.
        </p>
      </>
    ) : null;
  }

  const sections: ProfileSection[] = layout.modules.map((m) => ({
    key: m.key,
    label: m.spec.label,
    icon: m.spec.icon,
  }));

  // Only the sections this viewer can actually reach are rendered — a hidden
  // section costs nothing, and its data never reaches the response.
  const visible = new Set(layout.modules.map((m) => m.key));
  const panels: Record<string, ReactNode> = {};
  const add = (key: ModuleKey, node: ReactNode) => {
    if (visible.has(key)) panels[key] = node;
  };

  add(
    "about",
    <AboutPanel
      details={details}
      bio={bio}
      website={website}
      joined={joined}
      isOwner={isOwner}
      typeLabel={spec.label}
      handle={handle}
    />,
  );
  add("achievements", <AchievementsShowcase achievements={achievements} />);
  add("portfolio", <ShowcasePanel kind="project" items={byKind.project} isOwner={isOwner} />);
  add("experience", <ShowcasePanel kind="experience" items={byKind.experience} isOwner={isOwner} />);
  add("education", <ShowcasePanel kind="education" items={byKind.education} isOwner={isOwner} />);
  add("certifications", <ShowcasePanel kind="certification" items={byKind.certification} isOwner={isOwner} />);
  add("awards", <ShowcasePanel kind="award" items={byKind.award} isOwner={isOwner} />);
  add("publications", <ShowcasePanel kind="publication" items={byKind.publication} isOwner={isOwner} />);
  add("skills", <SkillsPanel skills={details.skills} isOwner={isOwner} />);
  add("resume", <ResumePanel url={details.resumeUrl} isOwner={isOwner} />);
  add("catalog", <CatalogPanel kind="product" items={products} isOwner={isOwner} />);
  add("services", <CatalogPanel kind="service" items={services} isOwner={isOwner} />);
  add("hours", <HoursPanel details={details} isOwner={isOwner} />);

  // A ?tab= that this viewer can't see falls back to the resolved landing
  // section rather than showing an empty dock.
  const active = initialTab && visible.has(initialTab as ModuleKey) ? initialTab : (layout.landing ?? sections[0]!.key);

  return (
    <>
      {previewBar}
      <ProfileTabs
        handle={handle}
        ownerId={profileId}
        isOwner={isOwner}
        sections={sections}
        initialTab={active}
        initialView={initialView}
        posts={posts}
        liked={liked}
        saved={saved}
        reposted={reposted}
        panels={panels}
      />
    </>
  );
}

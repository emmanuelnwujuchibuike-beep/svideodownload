import { ProfileHub } from "@/features/profile/profile-hub";
import { ProfilePreviewBar } from "@/features/profile/preview-bar";
import { ProfileTabs, type ProfileSection } from "@/features/profile/profile-tabs";
import type { ViewerRole } from "@/lib/profile/audience";
import { resolveProfileLayout, type StoredModule } from "@/lib/profile/engine";
import { HUB_OWNER_KEYS, MEDIA_MODULE_KEYS, isHubKey, type HubEntry } from "@/lib/profile/hub";
import { hasAboutBeyondHero } from "@/lib/profile/hub-substance";
import type { ModuleKey } from "@/lib/profile/modules";
import type { ProfileTypeKey } from "@/lib/profile/profile-types";
import { earnedCount, type EarnedAchievement } from "@/lib/social/achievements";
import type { PostCard } from "@/lib/social/posts";
import { credentialsByKind, type Credential, type Offering, type ProfileDetails } from "@/lib/social/profile-platform";

/**
 * Universal Profile Engine™ — the render side (Feature 18 · Part 14).
 *
 * Takes everything the page already fetched, asks the engine what THIS viewer
 * should see, and splits the answer in two:
 *
 *   · the MEDIA modules (posts, reels, downloads, collections, reposts, wows,
 *     saved) go to the navigation dock and the grid, exactly as before;
 *   · every OTHER module becomes a button on the hub (owner, 2026-09-13:
 *     "put all the cards in a button and they open as a premium modal… except
 *     the hero, experience mode and media grid"). The hub carries a key and a
 *     short fact per section — never the section's rows — and the modal reads
 *     the rows through /api/profile/<handle>/hub/<key> when it is about to be
 *     looked at.
 *
 * The important property survives: this is the ONLY place that decides which
 * sections exist, and it is used by the owner branch and the visitor branch
 * alike. The two heroes differ; what a profile can show does not. The API
 * re-runs the same resolver on every read, so a hidden section stays hidden
 * even to a hand-typed URL.
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
  website,
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
  website: string | null;
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

  // Gate 4 of the engine — SUBSTANCE. Every one of these is a real count, so a
  // visitor is never sent to a section that turns out to be a placeholder.
  // `about` counts only what the hero does NOT already show (hub-substance.ts).
  const content: Partial<Record<ModuleKey, boolean>> = {
    posts: posts.length > 0,
    reels: posts.some((p) => p.mediaKind === "video"),
    downloads: isOwner || posts.some((p) => p.platform && p.platform !== "frenz"),
    collections: collectionsCount > 0,
    reposted: reposted.length > 0,
    liked: liked.length > 0,
    saved: saved.length > 0,
    about: hasAboutBeyondHero(details, website),
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

  const media = layout.modules.filter((m) => MEDIA_MODULE_KEYS.has(m.key));
  const sections: ProfileSection[] = media.map((m) => ({ key: m.key, label: m.spec.label, icon: m.spec.icon }));

  /*
    The hub: the engine's other modules, then — for the owner, and only the
    real owner, never a previewed role — the cards that stood in the rail.
    Each entry carries one short fact so the button says something true
    before its section is ever read.
  */
  const counts: Partial<Record<ModuleKey, string | null>> = {
    achievements: `${earnedCount(achievements)} earned`,
    portfolio: plural(byKind.project.length, "project"),
    experience: plural(byKind.experience.length, "role"),
    education: plural(byKind.education.length, "entry", "entries"),
    certifications: plural(byKind.certification.length, "certification"),
    awards: plural(byKind.award.length, "award"),
    publications: plural(byKind.publication.length, "publication"),
    skills: plural(details.skills.length, "skill"),
    catalog: plural(products.length, "product"),
    services: plural(services.length, "service"),
  };
  const entries: HubEntry[] = layout.modules
    .filter((m) => !MEDIA_MODULE_KEYS.has(m.key) && isHubKey(m.key))
    .map((m) => ({ key: m.key as HubEntry["key"], sub: m.hasContent ? (counts[m.key] ?? null) : isOwner ? "Nothing here yet" : null }));
  if (isOwner && !previewRole) {
    for (const key of HUB_OWNER_KEYS) entries.push({ key, sub: null });
  }

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

  // A ?tab= that this viewer can't see falls back to the resolved landing
  // section rather than showing an empty dock. Only media sections are tabs
  // now; a hub key in the URL simply lands on the first grid.
  const mediaKeys = new Set(sections.map((s) => s.key));
  const landing = layout.landing && mediaKeys.has(layout.landing) ? layout.landing : (sections[0]?.key ?? null);
  const active = initialTab && mediaKeys.has(initialTab) ? initialTab : landing;

  return (
    <>
      {previewBar}
      {sections.length > 0 && active ? (
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
        />
      ) : null}
      <ProfileHub handle={handle} entries={entries} />
    </>
  );
}

function plural(n: number, one: string, many = `${one}s`): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? one : many}`;
}

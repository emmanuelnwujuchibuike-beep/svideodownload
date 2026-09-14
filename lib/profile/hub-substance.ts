import type { HubEngineKey } from "@/lib/profile/hub";
import { earnedCount, type EarnedAchievement } from "@/lib/social/achievements";
import type { Credential, Offering, ProfileDetails } from "@/lib/social/profile-platform";

/**
 * Gate 4 of the profile engine — SUBSTANCE — for the hub's engine keys, as
 * one pure rule the page (features/profile/profile-sections.tsx) and the
 * API (lib/profile/hub-data.ts) both apply, so a section the page offers is
 * a section the API answers, and never the reverse.
 */
export function engineSubstance(
  key: HubEngineKey,
  input: {
    details: ProfileDetails;
    byKind: Record<Credential["kind"], Credential[]>;
    products: Offering[];
    services: Offering[];
    /** Null when the caller did not compute them; the gate then passes. */
    achievements: EarnedAchievement[] | null;
    website: string | null;
  },
): boolean {
  const { details, byKind } = input;
  switch (key) {
    case "about":
      return hasAboutBeyondHero(details, input.website);
    case "achievements":
      return input.achievements ? earnedCount(input.achievements) > 0 : true;
    case "portfolio":
      return byKind.project.length > 0;
    case "experience":
      return byKind.experience.length > 0;
    case "education":
      return byKind.education.length > 0;
    case "certifications":
      return byKind.certification.length > 0;
    case "awards":
      return byKind.award.length > 0;
    case "publications":
      return byKind.publication.length > 0;
    case "skills":
      return details.skills.length > 0;
    case "resume":
      return !!details.resumeUrl;
    case "catalog":
      return input.products.length > 0;
    case "services":
      return input.services.length > 0;
    case "hours":
      return details.hours.some((h) => !h.closed) || !!details.address || !!details.city;
  }
}

/**
 * The hero already shows the headline, the bio, the website and the joined
 * date (owner, 2026-09-13: the About card was "a duplicate section card"). An
 * About entry exists only for what the hero does NOT show.
 */
export function hasAboutBeyondHero(details: ProfileDetails, _website: string | null): boolean {
  return (
    !!details.mission ||
    !!details.contactEmail ||
    !!details.contactPhone ||
    !!details.category ||
    !!details.founded ||
    !!details.teamSize ||
    !!details.availability ||
    !!details.address ||
    !!details.city ||
    !!details.country ||
    details.languages.length > 0
  );
}

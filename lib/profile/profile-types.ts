/**
 * Universal Profile Engine™ — the profile TYPE registry (Feature 18 · Part 14).
 *
 * ── The thesis ────────────────────────────────────────────────────────────
 * There is ONE profile. A member never creates a second account to become a
 * creator, a business or a professional — they declare what this identity is
 * FOR, and the profile grows the sections that purpose needs. Nothing is
 * duplicated, nothing is migrated, no data moves: `profiles.profile_type` is a
 * single column, and everything downstream (which modules exist, what the
 * landing section is, which verification lane applies) is DERIVED from it.
 *
 * ── Why a registry and not a union of components ──────────────────────────
 * Every other platform surface here is a catalogue (`lib/platform/*`), for the
 * same reason: adding "Medical", "Sports" or "University" later must be ONE
 * entry in ONE array, not a new route tree, a new settings page and a new set
 * of tabs. The type declares its default module set; the engine resolves the
 * rest. That is the whole future-proofing story — see `modules.ts` for the
 * pieces and `engine.ts` for the resolution.
 *
 * ── Honesty rule ──────────────────────────────────────────────────────────
 * Types the platform cannot actually verify or serve yet (Government,
 * Educational Institution) are declared with `available: false`. They appear
 * in the registry — so the engineering is genuinely future-shaped — but the
 * picker renders them as clearly-marked "Later" and refuses to store them. A
 * member is never given a switch that silently does nothing.
 *
 * Pure data: no React, no Supabase, safe on both sides of the wire.
 */

import type { ModuleKey } from "@/lib/profile/modules";

export type ProfileTypeKey =
  | "personal"
  | "creator"
  | "business"
  | "professional"
  | "student"
  | "developer"
  | "community"
  | "organization"
  | "government"
  | "education";

export interface ProfileTypeSpec {
  key: ProfileTypeKey;
  label: string;
  /** One line, written for the member choosing it — not marketing copy. */
  tagline: string;
  /** Lucide icon name; resolved by the UI so this file stays render-free. */
  icon: string;
  /** A `SETTINGS_TINTS` key, so the type reads consistently everywhere. */
  tint: string;
  /** Turned on the moment a member adopts this type (order matters). */
  defaultModules: ModuleKey[];
  /** Where visitors land by default. Must appear in `defaultModules`. */
  defaultLanding: ModuleKey;
  /**
   * The lane this type maps to in the EXISTING verification platform
   * (`lib/social/verification-shared.ts`). The brief asks for a badge per
   * verification kind; rather than invent a second parallel system, a profile
   * type simply pre-selects the application category it corresponds to.
   */
  verificationCategory: "creator" | "business" | "public_figure" | "journalist" | "government" | "other";
  /** False = declared for the future; not selectable, never stored. */
  available: boolean;
}

export const PROFILE_TYPES: ProfileTypeSpec[] = [
  {
    key: "personal",
    label: "Personal",
    tagline: "Your own space — posts, friends and the things you save.",
    icon: "UserRound",
    tint: "blue",
    defaultModules: ["posts", "reels", "downloads", "collections", "about"],
    defaultLanding: "posts",
    verificationCategory: "other",
    available: true,
  },
  {
    key: "creator",
    label: "Creator",
    tagline: "You publish to an audience. Lead with your work.",
    icon: "Sparkles",
    tint: "violet",
    defaultModules: ["posts", "reels", "collections", "achievements", "about"],
    defaultLanding: "posts",
    verificationCategory: "creator",
    available: true,
  },
  {
    key: "business",
    label: "Business",
    tagline: "A company or brand. Show what you sell and how to reach you.",
    icon: "Store",
    tint: "emerald",
    defaultModules: ["about", "catalog", "services", "hours", "posts", "reels"],
    defaultLanding: "about",
    verificationCategory: "business",
    available: true,
  },
  {
    key: "professional",
    label: "Professional",
    tagline: "Designer, consultant, photographer, researcher — lead with your portfolio.",
    icon: "Briefcase",
    tint: "amber",
    defaultModules: ["about", "portfolio", "experience", "skills", "certifications", "posts"],
    defaultLanding: "about",
    verificationCategory: "other",
    available: true,
  },
  {
    key: "student",
    label: "Student",
    tagline: "Studying. Show what you're learning and what you've built.",
    icon: "GraduationCap",
    tint: "cyan",
    defaultModules: ["about", "education", "portfolio", "certifications", "skills", "posts"],
    defaultLanding: "about",
    verificationCategory: "other",
    available: true,
  },
  {
    key: "developer",
    label: "Developer",
    tagline: "Ship software. Projects, skills and what you've built in public.",
    icon: "Code2",
    tint: "slate",
    defaultModules: ["about", "portfolio", "skills", "experience", "certifications", "posts"],
    defaultLanding: "about",
    verificationCategory: "other",
    available: true,
  },
  {
    key: "community",
    label: "Community",
    tagline: "A group of people. Say what it's for and who runs it.",
    icon: "Users",
    tint: "rose",
    defaultModules: ["about", "posts", "reels", "collections"],
    defaultLanding: "about",
    verificationCategory: "other",
    available: true,
  },
  {
    key: "organization",
    label: "Organization",
    tagline: "A non-profit, association or institution with a public mission.",
    icon: "Building2",
    tint: "purple",
    defaultModules: ["about", "services", "hours", "posts", "certifications"],
    defaultLanding: "about",
    verificationCategory: "business",
    available: true,
  },
  // ── Declared for the future, deliberately NOT selectable ────────────────
  // Both require a verification lane this platform cannot yet operate (proof
  // of office / accreditation), so offering the switch would be a promise the
  // product can't keep. They live here so the engine is genuinely built for
  // them — the day the lane exists, `available: true` is the whole change.
  {
    key: "government",
    label: "Government",
    tagline: "A public body or official. Needs an accredited verification lane.",
    icon: "Landmark",
    tint: "slate",
    defaultModules: ["about", "posts", "services"],
    defaultLanding: "about",
    verificationCategory: "government",
    available: false,
  },
  {
    key: "education",
    label: "Educational institution",
    tagline: "A school or university. Needs an accredited verification lane.",
    icon: "School",
    tint: "amber",
    defaultModules: ["about", "education", "posts", "services"],
    defaultLanding: "about",
    verificationCategory: "other",
    available: false,
  },
];

const BY_KEY = new Map(PROFILE_TYPES.map((t) => [t.key, t]));

/** The default — every existing account is a personal profile until it says otherwise. */
export const DEFAULT_PROFILE_TYPE: ProfileTypeKey = "personal";

/** The spec for a stored type, falling back to Personal for unknown/legacy values. */
export function profileType(key: string | null | undefined): ProfileTypeSpec {
  return BY_KEY.get((key ?? "") as ProfileTypeKey) ?? BY_KEY.get(DEFAULT_PROFILE_TYPE)!;
}

/** Types a member may actually switch to today. */
export function selectableProfileTypes(): ProfileTypeSpec[] {
  return PROFILE_TYPES.filter((t) => t.available);
}

/** Types declared for later — rendered as "Later", never stored. */
export function futureProfileTypes(): ProfileTypeSpec[] {
  return PROFILE_TYPES.filter((t) => !t.available);
}

/** True when `key` is a type the platform will accept a write for. */
export function isSelectableProfileType(key: string): key is ProfileTypeKey {
  return BY_KEY.get(key as ProfileTypeKey)?.available === true;
}

/**
 * The keys the API accepts. Derived from the registry rather than hand-listed,
 * so a future type can never be accepted by the API before its UI exists (or
 * rejected after it does) — the `available` flag is the single source of truth.
 */
export const SELECTABLE_PROFILE_TYPE_KEYS = PROFILE_TYPES.filter((t) => t.available).map((t) => t.key) as [
  ProfileTypeKey,
  ...ProfileTypeKey[],
];

/**
 * Does this type present a business-shaped surface (contact, hours, catalog)?
 * Drives the adaptive visitor action bar and which detail editors are offered.
 */
export function isCommercialType(key: ProfileTypeKey): boolean {
  return key === "business" || key === "organization" || key === "government";
}

/** Does this type present a professional showcase (portfolio, experience)? */
export function isProfessionalType(key: ProfileTypeKey): boolean {
  return key === "professional" || key === "student" || key === "developer";
}

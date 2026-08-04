/**
 * Smart Profile Modules™ — the catalogue of everything a profile can show
 * (Feature 18 · Part 14).
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * A profile is not a fixed page with fixed tabs; it is an ORDERED LIST OF
 * MODULES. A module declares what it is, which profile types offer it, where
 * its data comes from, and the minimum audience allowed to see it. The member
 * turns modules on and off and orders them; `engine.ts` resolves that against
 * the viewer and against what data actually exists.
 *
 * ── DECLARE all, DERIVE availability ─────────────────────────────────────
 * Every module is declared here whether or not this member has filled it in.
 * Whether it RENDERS is derived: a visitor never sees an empty Portfolio tab,
 * while the owner always sees it (with an empty state inviting them to fill
 * it). Same rule the Download Hub uses — the catalogue is complete, the
 * surface is honest.
 *
 * ── `status` is not decoration ────────────────────────────────────────────
 * `live` modules read real rows. `planned` modules are declared because the
 * platform is designed for them, but they have no backend yet, so they can
 * never be enabled and never render — `needs` says exactly what is missing.
 * Nothing here fabricates content to look finished.
 *
 * Pure data: no React, no Supabase.
 */

import type { ProfileTypeKey } from "@/lib/profile/profile-types";

export type ModuleKey =
  // Content the platform already stores
  | "posts"
  | "reels"
  | "downloads"
  | "reposted"
  | "liked"
  | "saved"
  | "collections"
  // Identity & standing
  | "about"
  | "achievements"
  // Professional showcase (profile_credentials)
  | "portfolio"
  | "experience"
  | "education"
  | "certifications"
  | "awards"
  | "publications"
  | "skills"
  | "resume"
  // Business (profile_offerings + profile_details)
  | "catalog"
  | "services"
  | "hours"
  // Declared for the future
  | "featured"
  | "memberships"
  | "events"
  | "reviews"
  | "team"
  | "repositories";

/** Who is allowed to see a module. Ordered least → most privileged. */
export type AudienceKey = "public" | "member" | "follower" | "friend" | "private";

export interface ModuleSpec {
  key: ModuleKey;
  label: string;
  /** Shown in the Modules settings so the choice is never a guess. */
  blurb: string;
  /** Lucide icon name, resolved by the UI. */
  icon: string;
  tint: string;
  /** Which profile types offer it. `"all"` = every type. */
  types: "all" | ProfileTypeKey[];
  /** `live` reads real rows; `planned` has no backend and cannot be enabled. */
  status: "live" | "planned";
  /** For `planned`: the backend it is waiting on, in plain words. */
  needs?: string;
  /**
   * The strictest audience a member may narrow this module to. Content that is
   * already governed by its own privacy setting elsewhere (Liked/Saved tabs)
   * is not re-litigated here.
   */
  audienceLocked?: boolean;
  /** Governed by an existing per-tab privacy setting rather than by modules. */
  governedElsewhere?: boolean;
}

export const PROFILE_MODULES: ModuleSpec[] = [
  /* ───────────────────────── Content ───────────────────────── */
  {
    key: "posts",
    label: "Posts",
    blurb: "Everything you've published.",
    icon: "Grid3x3",
    tint: "blue",
    types: "all",
    status: "live",
  },
  {
    key: "reels",
    label: "Reels",
    blurb: "Your video posts, as a reel wall.",
    icon: "Clapperboard",
    tint: "violet",
    types: "all",
    status: "live",
  },
  {
    key: "downloads",
    label: "Downloads",
    blurb: "Videos you saved from other platforms.",
    icon: "Download",
    tint: "cyan",
    types: "all",
    status: "live",
  },
  {
    key: "collections",
    label: "Collections",
    blurb: "Posts you grouped into collections.",
    icon: "FolderHeart",
    tint: "rose",
    types: "all",
    status: "live",
  },
  {
    key: "reposted",
    label: "Reposts",
    blurb: "Posts you reshared.",
    icon: "Repeat2",
    tint: "emerald",
    types: "all",
    status: "live",
    governedElsewhere: true,
  },
  {
    key: "liked",
    label: "Wows",
    blurb: "Posts you reacted to.",
    icon: "Heart",
    tint: "rose",
    types: "all",
    status: "live",
    governedElsewhere: true,
  },
  {
    key: "saved",
    label: "Saved",
    blurb: "Posts you bookmarked.",
    icon: "Bookmark",
    tint: "amber",
    types: "all",
    status: "live",
    governedElsewhere: true,
  },

  /* ──────────────────── Identity & standing ─────────────────── */
  {
    key: "about",
    label: "About",
    blurb: "Your story, links, contact details and what this profile is for.",
    icon: "IdCard",
    tint: "violet",
    types: "all",
    status: "live",
  },
  {
    key: "achievements",
    label: "Achievements",
    blurb: "Trophies you've earned, computed from your real activity.",
    icon: "Trophy",
    tint: "amber",
    types: "all",
    status: "live",
  },

  /* ─────────────────── Professional showcase ────────────────── */
  {
    key: "portfolio",
    label: "Portfolio",
    blurb: "Projects and work you want judged.",
    icon: "LayoutGrid",
    tint: "blue",
    types: ["professional", "student", "developer", "creator", "business", "organization"],
    status: "live",
  },
  {
    key: "experience",
    label: "Experience",
    blurb: "Roles you've held, with dates.",
    icon: "Briefcase",
    tint: "amber",
    types: ["professional", "student", "developer", "creator", "organization"],
    status: "live",
  },
  {
    key: "education",
    label: "Education",
    blurb: "Schools, degrees and courses.",
    icon: "GraduationCap",
    tint: "cyan",
    types: ["professional", "student", "developer", "education", "organization"],
    status: "live",
  },
  {
    key: "certifications",
    label: "Certifications",
    blurb: "Credentials you hold, with the issuer.",
    icon: "BadgeCheck",
    tint: "emerald",
    types: ["professional", "student", "developer", "business", "organization", "education"],
    status: "live",
  },
  {
    key: "awards",
    label: "Awards",
    blurb: "Recognition you've received.",
    icon: "Award",
    tint: "purple",
    types: ["professional", "student", "developer", "creator", "business", "organization"],
    status: "live",
  },
  {
    key: "publications",
    label: "Publications",
    blurb: "Papers, articles and written work you authored.",
    icon: "BookOpen",
    tint: "slate",
    types: ["professional", "student", "developer", "organization", "education"],
    status: "live",
  },
  {
    key: "skills",
    label: "Skills",
    blurb: "What you actually do, in your words.",
    icon: "Sparkles",
    tint: "violet",
    types: ["professional", "student", "developer", "creator", "business"],
    status: "live",
  },
  {
    key: "resume",
    label: "Résumé",
    blurb: "A link to your full CV.",
    icon: "FileText",
    tint: "slate",
    types: ["professional", "student", "developer"],
    status: "live",
  },

  /* ────────────────────────── Business ──────────────────────── */
  {
    key: "catalog",
    label: "Products",
    blurb: "What you sell, with prices and links.",
    icon: "Package",
    tint: "emerald",
    types: ["business", "organization", "creator", "professional"],
    status: "live",
  },
  {
    key: "services",
    label: "Services",
    blurb: "What you offer and what it costs.",
    icon: "Wrench",
    tint: "blue",
    types: ["business", "organization", "professional", "developer", "government", "education"],
    status: "live",
  },
  {
    key: "hours",
    label: "Hours & location",
    blurb: "When you're open and where to find you.",
    icon: "Clock",
    tint: "amber",
    types: ["business", "organization", "government", "education"],
    status: "live",
  },

  /* ─────────────── Backed by migration 0110 (Part 16b) ─────────── */
  {
    key: "featured",
    label: "Featured",
    blurb: "Pin your best posts, products or projects to the top.",
    icon: "Pin",
    tint: "violet",
    types: "all",
    status: "live",
  },
  {
    key: "memberships",
    label: "Memberships",
    blurb: "Support tiers, linking to where you take payment.",
    icon: "Crown",
    tint: "amber",
    types: ["creator", "business", "organization"],
    status: "live",
  },
  {
    key: "events",
    label: "Events",
    blurb: "What's coming up, and who's going.",
    icon: "CalendarDays",
    tint: "rose",
    types: ["business", "organization", "community", "creator", "education", "government"],
    status: "live",
  },
  {
    key: "reviews",
    label: "Reviews",
    blurb: "What people say about working with you.",
    icon: "Star",
    tint: "amber",
    types: ["business", "organization", "professional"],
    status: "live",
  },
  {
    key: "team",
    label: "Team",
    blurb: "The people behind this profile. Listing only — grants no access.",
    icon: "Users",
    tint: "cyan",
    types: ["business", "organization", "community", "government", "education"],
    status: "live",
  },
  {
    key: "repositories",
    label: "Repositories",
    blurb: "Repositories and open-source work you list.",
    icon: "GitBranch",
    tint: "slate",
    types: ["developer", "organization"],
    status: "live",
  },
];

const BY_KEY = new Map(PROFILE_MODULES.map((m) => [m.key, m]));

export function profileModule(key: string): ModuleSpec | undefined {
  return BY_KEY.get(key as ModuleKey);
}

/** Every module a given profile type may offer, in catalogue order. */
export function modulesForType(type: ProfileTypeKey): ModuleSpec[] {
  return PROFILE_MODULES.filter((m) => m.types === "all" || m.types.includes(type));
}

/** The live subset — the only modules that can be enabled. */
export function liveModulesForType(type: ProfileTypeKey): ModuleSpec[] {
  return modulesForType(type).filter((m) => m.status === "live");
}

export function isLiveModule(key: string): key is ModuleKey {
  return BY_KEY.get(key as ModuleKey)?.status === "live";
}

export const MODULE_KEYS = PROFILE_MODULES.map((m) => m.key) as [ModuleKey, ...ModuleKey[]];
export const LIVE_MODULE_KEYS = PROFILE_MODULES.filter((m) => m.status === "live").map((m) => m.key) as [
  ModuleKey,
  ...ModuleKey[],
];

/* ─────────────────────────── Audience ─────────────────────────── */

export const AUDIENCES: { key: AudienceKey; label: string; blurb: string }[] = [
  { key: "public", label: "Everyone", blurb: "Anyone, signed in or not." },
  { key: "member", label: "Members", blurb: "Anyone signed in to Frenzsave." },
  { key: "follower", label: "Followers", blurb: "People who follow you." },
  { key: "friend", label: "Friends", blurb: "People you're friends with." },
  { key: "private", label: "Only me", blurb: "Nobody but you." },
];

export const AUDIENCE_KEYS = AUDIENCES.map((a) => a.key) as [AudienceKey, ...AudienceKey[]];

export const DEFAULT_MODULE_AUDIENCE: AudienceKey = "public";

export function audienceLabel(key: AudienceKey): string {
  return AUDIENCES.find((a) => a.key === key)?.label ?? "Everyone";
}

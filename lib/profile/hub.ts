import type { ModuleKey } from "@/lib/profile/modules";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PROFILE HUB — every section that is NOT the hero, the mode or the grid
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "remove this section card and any other duplicate
 * section card in the profile page and put all the cards in a button and
 * they open as a premium modal, all sections card except from the hero,
 * experience mode and media grid… to free up the profile landing budget and
 * speed so all modal prefetch as they scroll and they shouldn't prefetch at
 * once, any that haven't cached or prefetched should show a strip loader.
 * The profile page should be extremely light."
 *
 * This is the catalogue: which sections exist as hub entries, what they are
 * called, and how they are drawn. It is PURE — the page decides which
 * entries a viewer gets (lib/profile/hub-data.ts re-checks on every read),
 * the client draws the buttons and fetches a section only when it is about
 * to be looked at.
 *
 * ── Two families ────────────────────────────────────────────────────────────
 *
 *   engine   the Universal Profile Engine's non-media modules (about,
 *            achievements, portfolio…). Whether a viewer may see one is the
 *            engine's decision (audience, circles, substance), and the same
 *            resolver answers the API.
 *   owner    the cards that stood in the owner's rail and under the hero
 *            (streak, health, reputation, journey, capsules, journal,
 *            analytics, tools, friends, activity, appearance). Owner only,
 *            always — none of them was ever shown to a visitor.
 */

export const HUB_ENGINE_KEYS = [
  "about",
  "achievements",
  "portfolio",
  "experience",
  "education",
  "certifications",
  "awards",
  "publications",
  "skills",
  "resume",
  "catalog",
  "services",
  "hours",
] as const satisfies readonly ModuleKey[];

export const HUB_OWNER_KEYS = [
  "streak",
  "reputation",
  "health",
  "analytics",
  "journey",
  "capsules",
  "journal",
  "friends",
  "activity",
  "tools",
  "appearance",
] as const;

export type HubEngineKey = (typeof HUB_ENGINE_KEYS)[number];
export type HubOwnerKey = (typeof HUB_OWNER_KEYS)[number];
export type HubKey = HubEngineKey | HubOwnerKey;

/** The media modules stay a grid; nothing here is one of them. */
export const MEDIA_MODULE_KEYS = new Set<ModuleKey>(["posts", "reels", "downloads", "reposted", "liked", "saved", "collections"]);

export function isHubKey(value: string): value is HubKey {
  return (HUB_ENGINE_KEYS as readonly string[]).includes(value) || (HUB_OWNER_KEYS as readonly string[]).includes(value);
}

export function isHubOwnerKey(value: string): value is HubOwnerKey {
  return (HUB_OWNER_KEYS as readonly string[]).includes(value);
}

/** What the button says. `icon` is a lucide name the client resolves. */
export interface HubMeta {
  label: string;
  blurb: string;
  icon: string;
  /** Two stops of the glossy tile. */
  tint: [string, string];
}

export const HUB_META: Record<HubKey, HubMeta> = {
  about: { label: "About", blurb: "Details & contact", icon: "IdCard", tint: ["#2563FF", "#6D5CFF"] },
  achievements: { label: "Achievements", blurb: "What's been earned", icon: "Trophy", tint: ["#F59E0B", "#F97316"] },
  portfolio: { label: "Portfolio", blurb: "Selected work", icon: "LayoutGrid", tint: ["#0EA5E9", "#2563FF"] },
  experience: { label: "Experience", blurb: "Roles & work", icon: "Briefcase", tint: ["#6366F1", "#8B5CF6"] },
  education: { label: "Education", blurb: "Schools & studies", icon: "GraduationCap", tint: ["#14B8A6", "#0EA5E9"] },
  certifications: { label: "Certifications", blurb: "Verified skills", icon: "BadgeCheck", tint: ["#22C55E", "#14B8A6"] },
  awards: { label: "Awards", blurb: "Recognition", icon: "Award", tint: ["#F59E0B", "#EF4444"] },
  publications: { label: "Publications", blurb: "Writing & papers", icon: "BookOpen", tint: ["#8B5CF6", "#EC4899"] },
  skills: { label: "Skills", blurb: "What they do", icon: "Sparkles", tint: ["#6D5CFF", "#EC4899"] },
  resume: { label: "Résumé", blurb: "Download the CV", icon: "FileText", tint: ["#64748B", "#334155"] },
  catalog: { label: "Products", blurb: "Things for sale", icon: "Package", tint: ["#F97316", "#EF4444"] },
  services: { label: "Services", blurb: "What's on offer", icon: "Wrench", tint: ["#0EA5E9", "#6366F1"] },
  hours: { label: "Hours & location", blurb: "When and where", icon: "Clock", tint: ["#10B981", "#0EA5E9"] },

  streak: { label: "Daily streak", blurb: "Keep the flame going", icon: "Flame", tint: ["#F97316", "#EF4444"] },
  reputation: { label: "Reputation", blurb: "Rank & trust", icon: "ShieldCheck", tint: ["#2563FF", "#6D5CFF"] },
  health: { label: "Profile health", blurb: "What to improve", icon: "HeartPulse", tint: ["#22C55E", "#10B981"] },
  analytics: { label: "Analytics", blurb: "Views, likes & reach", icon: "BarChart3", tint: ["#4F46E5", "#0EA5E9"] },
  journey: { label: "Life journey", blurb: "Your milestones", icon: "Flag", tint: ["#6D5CFF", "#EC4899"] },
  capsules: { label: "Time capsules", blurb: "Notes to the future", icon: "Hourglass", tint: ["#8B5CF6", "#6D5CFF"] },
  journal: { label: "Private journal", blurb: "Only you can read it", icon: "NotebookPen", tint: ["#A78BFA", "#EC4899"] },
  friends: { label: "Top friends", blurb: "Your closest circle", icon: "Users", tint: ["#EC4899", "#F97316"] },
  activity: { label: "Recent activity", blurb: "What's been happening", icon: "Activity", tint: ["#0EA5E9", "#22C55E"] },
  tools: { label: "Creator tools", blurb: "Studio, analytics & more", icon: "Wand2", tint: ["#2563FF", "#8B5CF6"] },
  appearance: { label: "Appearance", blurb: "Light or dark", icon: "SunMoon", tint: ["#334155", "#0F172A"] },
};

/** One button on the hub, as the page hands it to the client. */
export interface HubEntry {
  key: HubKey;
  /** A short fact under the label ("12 earned", "3 roles"); null keeps the blurb. */
  sub: string | null;
}

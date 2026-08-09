/**
 * Settings Center™ — the category registry (Feature 18 · Part 21).
 *
 * ── Why categories are declared, not derived from the settings ───────────────
 * Deriving the category list from whatever settings happen to exist would make
 * an empty category invisible — and an empty category is INFORMATION. "Music"
 * with nothing under it says Frenz has not built music settings; "Music" absent
 * says nothing at all, and a member searching for it gets silence.
 *
 * Same reasoning as `lib/analytics/pages.ts`: a zero is worth rendering.
 *
 * Pure data. No React, no Supabase, no I/O — so this is safe to import from a
 * client component, a server component or a test.
 */

export type CategoryStatus =
  /** Reachable and configurable by a member today. */
  | "live"
  /** Named by the Part 21 brief, deliberately not built. `note` says why. */
  | "planned";

export interface SettingsCategory {
  id: string;
  label: string;
  /** One line — what a member controls here. */
  blurb: string;
  /** Lucide icon name, resolved by the UI so this module stays render-free. */
  icon: string;
  /** Shared tint key from `features/account/settings-ui`. */
  tint: string;
  status: CategoryStatus;
  /** For `planned`: what is missing. Never "out of scope". */
  note?: string;
}

/**
 * The 24 categories from the Part 21 brief, in the order the Settings Center
 * renders them.
 *
 * Order is by HOW OFTEN a category is opened, not alphabetically and not by the
 * brief's listing order. Account/Profile/Appearance/Privacy/Security/
 * Notifications are the six people actually come for; the ecosystem categories
 * follow; Developer Options is last because it is explicitly future.
 */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { id: "account", label: "Account", blurb: "Plan, password, and your account itself.", icon: "UserCog", tint: "violet", status: "live" },
  { id: "profile", label: "Profile", blurb: "Identity, sections, layout and verification.", icon: "Layers", tint: "blue", status: "live" },
  { id: "appearance", label: "Appearance", blurb: "Theme, accent, motion and typography.", icon: "Palette", tint: "purple", status: "live" },
  { id: "privacy", label: "Privacy", blurb: "Who can see you, find you and reach you.", icon: "Lock", tint: "emerald", status: "live" },
  { id: "security", label: "Security", blurb: "Sign-in, PIN, passkeys and sessions.", icon: "ShieldCheck", tint: "cyan", status: "live" },
  { id: "notifications", label: "Notifications", blurb: "What reaches you, and how loudly.", icon: "Bell", tint: "rose", status: "live" },
  { id: "messaging", label: "Messaging", blurb: "Chat appearance, requests and read receipts.", icon: "MessageCircle", tint: "blue", status: "live" },
  { id: "feed", label: "Feed", blurb: "What the home feed shows you first.", icon: "LayoutGrid", tint: "violet", status: "live" },
  { id: "downloads", label: "Downloads", blurb: "Quality, saving and your library.", icon: "Download", tint: "blue", status: "live" },
  { id: "language", label: "Language & region", blurb: "Language, region, dates and units.", icon: "Languages", tint: "amber", status: "live" },
  { id: "storage", label: "Storage", blurb: "What is stored on this device and in the cloud.", icon: "Database", tint: "slate", status: "live" },
  /*
    `planned`, not `live` — caught by `settings.test.ts`, which requires a live
    category to have at least one setting a member can actually change. Frenz
    honours Save-Data and effectiveType already, but only automatically; there
    is no switch, so a "Data usage" screen would open on nothing.
  */
  { id: "data", label: "Data usage", blurb: "How much Frenz downloads on your connection.", icon: "Activity", tint: "emerald", status: "planned", note: "The app already reduces media on Save-Data and slow connections, but that is automatic — there is no member-facing control to put on a screen yet." },
  { id: "accessibility", label: "Accessibility", blurb: "Motion, contrast and reading comfort.", icon: "Accessibility", tint: "purple", status: "live" },
  { id: "devices", label: "Connected devices", blurb: "Where you are signed in.", icon: "MonitorSmartphone", tint: "cyan", status: "live" },

  /*
    ── Declared, not built ────────────────────────────────────────────────────
    Each of these is a product Frenz has not shipped. They are listed so a
    member searching for them gets an honest answer instead of an empty result,
    and so the settings surface exists the day the product does.

    `note` says what is actually missing — never "out of scope", which tells a
    reader nothing and ages badly.
  */
  { id: "stories", label: "Stories", blurb: "Who sees your stories, and for how long.", icon: "Clapperboard", tint: "rose", status: "planned", note: "Stories exist; their settings still live inside the composer rather than here." },
  { id: "music", label: "Music", blurb: "Playback, audio quality and library.", icon: "Music", tint: "violet", status: "planned", note: "No music product yet." },
  { id: "live", label: "Live streaming", blurb: "Stream quality, moderation and replays.", icon: "Radio", tint: "rose", status: "planned", note: "No live product yet." },
  { id: "communities", label: "Communities", blurb: "Membership, roles and community alerts.", icon: "Users", tint: "blue", status: "planned", note: "No communities product yet." },
  { id: "marketplace", label: "Marketplace", blurb: "Listings, orders and payouts.", icon: "Store", tint: "emerald", status: "planned", note: "Marketplace was REMOVED in the AdSense content cleanup (2026-08-02) and has not returned." },
  { id: "creator", label: "Creator platform", blurb: "Monetisation, analytics and creator tools.", icon: "Sparkles", tint: "amber", status: "planned", note: "Creator analytics exist under Profile; there is no separate creator platform." },
  { id: "business", label: "Business platform", blurb: "Business profile, hours and catalogue.", icon: "Briefcase", tint: "emerald", status: "live" },
  { id: "ai", label: "AI Studio", blurb: "Assistants, generation and AI privacy.", icon: "Sparkles", tint: "purple", status: "planned", note: "No AI Studio product yet. The settings assistant itself is designed but unbuilt — see docs/FEATURE_18_PART_21_SETTINGS_CENTER.md." },
  { id: "automation", label: "Automation", blurb: "Rules that change settings for you.", icon: "Workflow", tint: "cyan", status: "planned", note: "Needs a scheduler: a PWA is not running at 10pm, so time-based rules require server-side evaluation. Designed in the Part 21 doc." },
  { id: "developer", label: "Developer", blurb: "API keys, usage and webhooks.", icon: "Code2", tint: "slate", status: "live" },
] as const;

const BY_ID = new Map(SETTINGS_CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): SettingsCategory | undefined {
  return BY_ID.get(id);
}

/** Categories a member can actually configure today. */
export function liveCategories(): SettingsCategory[] {
  return SETTINGS_CATEGORIES.filter((c) => c.status === "live");
}

/** Rank for sorting — the declared order, so results never depend on array churn. */
export function categoryRank(id: string): number {
  const i = SETTINGS_CATEGORIES.findIndex((c) => c.id === id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

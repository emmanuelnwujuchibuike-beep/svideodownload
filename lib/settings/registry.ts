/**
 * Settings Center™ — every setting Frenz has, declared once (Part 21).
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 * The spine of the Settings Center. The root page renders from it, Smart
 * Settings Search reads it, the dashboard links through it, and a future AI
 * assistant answers from it. One declaration, many surfaces.
 *
 * ── What it is NOT ───────────────────────────────────────────────────────────
 * It never stores, reads or writes a preference. Each entry POINTS AT the
 * surface that owns its value, and that surface keeps its own table and its own
 * RLS.
 *
 * That is deliberate and it is a security decision as much as an architectural
 * one. Preferences already live in six domain-owned tables — `privacy_settings`
 * (0006), `user_home_preferences` (0040), `notification_settings` (0046),
 * `account_security_settings` (0055), `chat_appearance_preferences` (0077),
 * profile appearance (0109). Collapsing them into one blob would put every
 * domain behind a single policy on a single hot row: weaker isolation, worse
 * contention, and a migration touching everything at once. The registry gives
 * the *discoverability* a single store would have given, and costs nothing.
 *
 * ── The problem it actually solves ───────────────────────────────────────────
 * `app/(app)/account/page.tsx` declared its 19 rows as a hand-written array
 * INSIDE JSX. Nothing could search them, nothing could summarise them, and a
 * new setting was invisible unless someone remembered to add a row. Every
 * complaint in the Part 21 brief follows from that one fact.
 *
 * Pure data + pure lookups. No React, no Supabase, no I/O.
 */

import { categoryRank } from "./categories";

export type SettingStatus =
  /** A member can change this today. */
  | "live"
  /** The value is stored and honoured, but no screen exposes it yet. */
  | "backend-only"
  /** Named by the brief, not built. `note` says what is missing. */
  | "planned";

export interface SettingEntry {
  /** Stable id — used by search results, pinning and (later) automation rules. */
  id: string;
  /** Category id from `./categories`. */
  category: string;
  /** What a member calls it. Sentence case. */
  label: string;
  /** One line: what changing it does. Shown under the label in search results. */
  description: string;
  /**
   * Everyday words someone might type instead of the label.
   *
   * ── This is where "semantic" search actually lives ────────────────────────
   * The brief asks for semantic search in everyday language. The alternative —
   * an embedding index — would mean a network request per keystroke and a model,
   * for a corpus of ~200 short strings. Explicit synonyms are DATA: reviewable
   * in a diff, correct by construction, and instant. "2fa" finds two-factor
   * because someone wrote that down, not because a model guessed.
   */
  keywords: readonly string[];
  /** Where the member goes to change it. Null for `planned` entries. */
  href: string | null;
  status: SettingStatus;
  /** For `planned`/`backend-only`: what is missing. Never "out of scope". */
  note?: string;
  /**
   * True for settings that change what OTHER people can see or do.
   * The Center flags these, because a privacy control that reads like a
   * cosmetic toggle is how people share more than they meant to.
   */
  affectsOthers?: boolean;
}

/*
  ── Every entry below points at a route that exists ──────────────────────────
  `registry.test.ts` asserts that: a `live` entry with an `href` no page serves
  is a dead affordance, and this codebase has had to remove those three times
  (admin corpora, help centre, the profile doorway). The test is the guard.
*/
export const SETTINGS: readonly SettingEntry[] = [
  /* ───────────────────────────────── account ────────────────────────────── */
  { id: "account.plan", category: "account", label: "Plan & billing", description: "Your plan, what it includes, and how to change it.", keywords: ["upgrade", "pro", "business", "premium", "subscription", "billing", "payment", "price", "cancel"], href: "/account/plan", status: "live" },
  { id: "account.password", category: "account", label: "Password", description: "Change the password you sign in with.", keywords: ["change password", "reset password", "credentials"], href: "/account/password", status: "live" },
  { id: "account.appeals", category: "account", label: "Appeals", description: "Challenge a moderation decision on your account or content.", keywords: ["appeal", "ban", "suspended", "restricted", "moderation", "dispute"], href: "/account/appeals", status: "live" },
  { id: "account.delete", category: "account", label: "Delete account", description: "Permanently remove your account and its data.", keywords: ["delete", "close account", "remove account", "deactivate", "erase"], href: null, status: "planned", note: "No self-serve deletion flow yet — account removal is handled through Support.", affectsOthers: true },

  /* ───────────────────────────────── profile ────────────────────────────── */
  { id: "profile.identity", category: "profile", label: "Identity", description: "Name, handle, photo, profile video, avatar and status.", keywords: ["name", "username", "handle", "photo", "picture", "avatar", "profile video", "bio", "status"], href: "/account/identity", status: "live" },
  { id: "profile.verification", category: "profile", label: "Verification", description: "Apply for a verified tick, or check your application.", keywords: ["verified", "blue tick", "checkmark", "badge", "verify"], href: "/account/verification", status: "live" },
  { id: "profile.health", category: "profile", label: "Profile health", description: "What is missing from your profile, and what to fix first.", keywords: ["score", "completeness", "improve profile", "coach", "suggestions"], href: "/account/health", status: "live" },
  { id: "profile.type", category: "profile", label: "Profile type", description: "Personal, creator, business or professional.", keywords: ["creator mode", "business mode", "switch profile", "account type"], href: "/account/profile-type", status: "live" },
  { id: "profile.modules", category: "profile", label: "Sections", description: "Which sections appear on your profile, and who can see each one.", keywords: ["sections", "modules", "blocks", "profile layout", "audience", "who can see"], href: "/account/modules", status: "live", affectsOthers: true },
  { id: "profile.layout", category: "profile", label: "Layout Studio", description: "Arrange your profile and choose its theme.", keywords: ["layout", "arrange", "theme", "profile design", "customise profile"], href: "/account/layout-studio", status: "live" },
  { id: "profile.business", category: "profile", label: "Business profile", description: "Overview, contact details, opening hours and catalogue.", keywords: ["business", "shop", "hours", "contact", "catalogue", "company"], href: "/account/business", status: "live" },
  { id: "profile.professional", category: "profile", label: "Professional profile", description: "Portfolio, experience and credentials.", keywords: ["portfolio", "cv", "resume", "experience", "work", "credentials"], href: "/account/professional", status: "live" },
  { id: "profile.analytics", category: "profile", label: "Your analytics", description: "How your profile and posts are performing.", keywords: ["stats", "insights", "views", "performance", "reach"], href: "/account/analytics", status: "live" },
  { id: "profile.versions", category: "profile", label: "Layout history", description: "Restore a previous profile layout.", keywords: ["history", "undo", "restore", "previous", "version", "revert"], href: "/account/layout-studio", status: "backend-only", note: "Part 20 built version history (migration 0114); it has no screen of its own yet and 0114 is unapplied." },

  /* ──────────────────────────────── appearance ──────────────────────────── */
  { id: "appearance.theme", category: "appearance", label: "Theme", description: "Light, dark, or follow your device.", keywords: ["dark mode", "light mode", "night mode", "colour scheme", "color scheme", "appearance"], href: "/account/appearance", status: "live" },
  { id: "appearance.accent", category: "appearance", label: "Accent colour", description: "The colour used for highlights and buttons.", keywords: ["accent", "colour", "color", "brand colour", "highlight"], href: "/account/appearance", status: "live" },
  { id: "appearance.home", category: "appearance", label: "Home layout", description: "What the home screen shows, and in what order.", keywords: ["home", "dashboard", "layout", "widgets", "rearrange"], href: "/account/appearance", status: "live" },
  { id: "appearance.chat", category: "appearance", label: "Chat appearance", description: "Wallpaper, bubble colour and text size in chats.", keywords: ["chat wallpaper", "bubbles", "chat theme", "message colour"], href: "/messages", status: "live" },

  /* ───────────────────────────────── privacy ────────────────────────────── */
  { id: "privacy.visibility", category: "privacy", label: "Who can see you", description: "Whether your profile is public, followers-only or private.", keywords: ["private account", "public", "visibility", "who can see", "hide profile"], href: "/account/privacy", status: "live", affectsOthers: true },
  { id: "privacy.relationships", category: "privacy", label: "Blocked & muted", description: "Accounts you have blocked, muted or restricted.", keywords: ["blocked users", "block", "mute", "muted accounts", "restrict", "unblock"], href: "/account/relationships", status: "live", affectsOthers: true },
  { id: "privacy.discovery", category: "privacy", label: "Discovery", description: "Whether people can find you by search, contacts or QR.", keywords: ["find me", "search", "discoverable", "contacts", "qr code", "suggestions"], href: "/account/discovery", status: "live", affectsOthers: true },
  { id: "privacy.ghost", category: "privacy", label: "Ghost Mode", description: "Hide your activity signals — online status, read receipts, views.", keywords: ["ghost", "invisible", "online status", "last seen", "read receipts", "typing", "hide activity"], href: "/account/ghost", status: "live", affectsOthers: true },
  { id: "privacy.views", category: "privacy", label: "Who viewed you", description: "Whether your profile view count is shown.", keywords: ["views", "profile views", "seen", "viewers"], href: "/account/privacy", status: "live", affectsOthers: true },

  /* ──────────────────────────────── security ────────────────────────────── */
  { id: "security.overview", category: "security", label: "Security", description: "Your security score, sign-in methods and recent activity.", keywords: ["security", "safety", "protect", "score"], href: "/account/security", status: "live" },
  { id: "security.pin", category: "security", label: "PIN", description: "A second lock on sensitive actions and chats.", keywords: ["pin", "passcode", "lock", "app lock", "secret chat"], href: "/account/security", status: "live" },
  { id: "security.passkey", category: "security", label: "Passkeys", description: "Sign in with your face, fingerprint or device.", keywords: ["passkey", "biometric", "face id", "fingerprint", "webauthn", "touch id"], href: "/account/security", status: "live" },
  { id: "security.2fa", category: "security", label: "Two-factor authentication", description: "Require a second step when signing in.", keywords: ["2fa", "two factor", "two-step", "otp", "authenticator", "mfa"], href: "/account/security", status: "live" },
  { id: "security.sessions", category: "security", label: "Where you are signed in", description: "Devices with an active session, and how to sign them out.", keywords: ["sessions", "devices", "sign out", "log out everywhere", "active devices"], href: "/account/security", status: "live" },
  { id: "security.recovery", category: "security", label: "Recovery codes", description: "One-time codes for getting back in if you lose your device.", keywords: ["recovery", "backup codes", "locked out", "lost phone"], href: "/account/security", status: "live" },

  /* ────────────────────────────── notifications ─────────────────────────── */
  { id: "notifications.all", category: "notifications", label: "Notification settings", description: "What Frenz notifies you about, per type.", keywords: ["notifications", "alerts", "push", "email", "sounds", "badges"], href: "/account/notifications", status: "live" },
  { id: "notifications.pause", category: "notifications", label: "Pause notifications", description: "Mute everything for a while.", keywords: ["pause", "do not disturb", "dnd", "quiet", "snooze", "mute all"], href: "/account/notifications", status: "live" },
  { id: "notifications.messages", category: "notifications", label: "Message notifications", description: "Alerts for direct messages and requests.", keywords: ["message alerts", "dm", "chat notifications"], href: "/account/notifications", status: "live" },
  { id: "notifications.social", category: "notifications", label: "Social notifications", description: "Mentions, tags, friend requests and reactions.", keywords: ["mentions", "tags", "friend requests", "likes", "comments", "follows"], href: "/account/notifications", status: "live" },

  /* ──────────────────────────────── messaging ───────────────────────────── */
  { id: "messaging.requests", category: "messaging", label: "Message requests", description: "Who may message you without being a friend.", keywords: ["who can message me", "requests", "dm privacy", "strangers"], href: "/account/privacy", status: "live", affectsOthers: true },
  { id: "messaging.receipts", category: "messaging", label: "Read receipts", description: "Whether people see when you have read their message.", keywords: ["read receipts", "seen", "blue ticks", "delivered"], href: "/account/ghost", status: "live", affectsOthers: true },

  /* ───────────────────────────────── stories ────────────────────────────── */
  /*
    Stories EXIST as a product; their settings do not live here yet — audience
    is chosen in the composer, per story. Declared so "story privacy" resolves
    to an honest answer instead of returning nothing, which is the whole reason
    planned entries are in the registry at all.
  */
  { id: "stories.privacy", category: "stories", label: "Story privacy", description: "Who can see your stories by default.", keywords: ["story privacy", "who can see my story", "story audience", "close friends", "hide story"], href: null, status: "planned", note: "Story audience is chosen per story in the composer; there is no saved default to edit here yet.", affectsOthers: true },
  { id: "stories.replies", category: "stories", label: "Story replies", description: "Who can reply to your stories.", keywords: ["story replies", "reply to story", "story messages"], href: null, status: "planned", note: "Replies follow your message-request setting; there is no separate story control yet.", affectsOthers: true },

  /* ────────────────────────────────── feed ──────────────────────────────── */
  { id: "feed.preferences", category: "feed", label: "Feed preferences", description: "What the home feed shows you first.", keywords: ["feed", "timeline", "home", "sort", "algorithm", "for you"], href: "/account/appearance", status: "live" },
  { id: "feed.content", category: "feed", label: "Content preferences", description: "Topics you want more or less of.", keywords: ["topics", "interests", "content", "less of this", "not interested"], href: "/account/appearance", status: "live" },

  /* ──────────────────────────────── downloads ───────────────────────────── */
  { id: "downloads.library", category: "downloads", label: "Your downloads", description: "Everything you have saved.", keywords: ["downloads", "library", "saved files", "history", "my videos"], href: "/downloads", status: "live" },
  { id: "downloads.saved", category: "downloads", label: "Saved posts", description: "Posts you bookmarked.", keywords: ["saved", "bookmarks", "favourites", "favorites"], href: "/saved", status: "live" },
  { id: "downloads.quality", category: "downloads", label: "Download quality", description: "Preferred quality when saving a video.", keywords: ["quality", "hd", "4k", "resolution", "file size", "default quality"], href: null, status: "planned", note: "Quality is chosen per download on the result card; there is no stored default yet." },

  /* ──────────────────────────── language & region ───────────────────────── */
  { id: "language.language", category: "language", label: "Language", description: "The language Frenz is shown in.", keywords: ["language", "translate", "english", "french", "arabic", "swahili", "hausa", "locale"], href: "/account/appearance", status: "live" },
  { id: "language.region", category: "language", label: "Region & formats", description: "Dates, times, numbers and units.", keywords: ["region", "country", "date format", "time format", "24 hour", "units", "currency", "timezone"], href: null, status: "backend-only", note: "`lib/i18n/format.ts` formats per locale already; there is no screen to override region independently of language." },

  /* ───────────────────────────────── storage ────────────────────────────── */
  { id: "storage.usage", category: "storage", label: "Storage used", description: "How much of your plan's storage your downloads take.", keywords: ["storage", "space", "quota", "full", "gb", "usage"], href: "/downloads", status: "live" },
  { id: "storage.clear", category: "storage", label: "Clear downloads", description: "Remove saved files from this device.", keywords: ["clear", "delete downloads", "free space", "cache", "cleanup"], href: "/downloads", status: "live" },

  /* ─────────────────────────────── data usage ───────────────────────────── */
  { id: "data.saver", category: "data", label: "Data saver", description: "Use less mobile data for media.", keywords: ["data saver", "mobile data", "cellular", "reduce data", "save data"], href: null, status: "backend-only", note: "The app already honours Save-Data and effectiveType for reels warm-up and media; there is no member-facing switch." },

  /* ────────────────────────────── accessibility ─────────────────────────── */
  { id: "accessibility.center", category: "accessibility", label: "Accessibility", description: "Text size, contrast, motion, colour filters and tap targets.", keywords: ["accessibility", "a11y", "text size", "larger text", "contrast", "colour blind", "color blind", "presets", "dyslexia", "low vision"], href: "/account/accessibility", status: "live" },
  { id: "accessibility.motion", category: "accessibility", label: "Reduce motion", description: "Turn off animations and movement.", keywords: ["motion", "animation", "reduce motion", "vestibular", "still"], href: "/account/accessibility", status: "live" },
  { id: "accessibility.text", category: "accessibility", label: "Text size", description: "Make everything in Frenz larger or smaller.", keywords: ["text size", "font size", "larger text", "bigger text", "dynamic type", "zoom"], href: "/account/accessibility", status: "live" },
  { id: "accessibility.contrast", category: "accessibility", label: "High contrast", description: "Darker text and stronger borders throughout.", keywords: ["contrast", "high contrast", "readable", "faint text"], href: "/account/accessibility", status: "live" },
  { id: "accessibility.haptics", category: "accessibility", label: "Haptics & sounds", description: "Vibration and sound feedback for taps.", keywords: ["haptics", "vibration", "sound", "feedback", "silent"], href: "/account/appearance", status: "live" },

  /* ─────────────────────────── connected devices ────────────────────────── */
  { id: "devices.sessions", category: "devices", label: "Connected devices", description: "Devices signed in to your account.", keywords: ["devices", "sessions", "phones", "computers", "sign out device", "remote logout"], href: "/account/security", status: "live" },

  /* ──────────────────────────────── business ────────────────────────────── */
  { id: "business.profile", category: "business", label: "Business settings", description: "Your business profile, hours and catalogue.", keywords: ["business", "shop", "store", "hours", "catalogue"], href: "/account/business", status: "live" },

  /* ─────────────────────────────── developer ────────────────────────────── */
  { id: "developer.keys", category: "developer", label: "API keys", description: "Create and revoke keys for the Frenz API.", keywords: ["api", "key", "token", "developer", "integration", "webhook"], href: "/account/developer", status: "live" },
] as const;

const BY_ID = new Map(SETTINGS.map((s) => [s.id, s]));

export function getSetting(id: string): SettingEntry | undefined {
  return BY_ID.get(id);
}

/** Every setting in one category, in declared order. */
export function settingsIn(categoryId: string): SettingEntry[] {
  return SETTINGS.filter((s) => s.category === categoryId);
}

/** Settings a member can actually change today. */
export function liveSettings(): SettingEntry[] {
  return SETTINGS.filter((s) => s.status === "live");
}

/**
 * Sort key: category order first, then declared order within it.
 *
 * Never array index alone — search results and the Center must agree on
 * ordering, and both must be stable across renders.
 */
export function settingRank(s: SettingEntry): number {
  return categoryRank(s.category) * 1000 + SETTINGS.indexOf(s);
}

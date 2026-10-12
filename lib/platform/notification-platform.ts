/**
 * The Enterprise Notification Platform, described by itself.
 *
 * The brief asks for a Notification Gateway, Delivery Engine, Template/Preference/
 * Subscription/Push/Email/Realtime/Digest/Scheduling/Analytics services, a
 * Delivery Intelligence™ layer and a Notification Registry™. As with the Search,
 * Media, Data, Design and Engineering platforms before it, the substrate ALREADY
 * EXISTS — this app shipped a mature notification system over Parts 6–9 — so this
 * file is the honest map over it, not a second implementation:
 *
 *   - the notification TYPE registry (`lib/platform/notifications-registry.ts`),
 *   - VAPID Web/PWA push + smart per-preference delivery (`lib/push/*`,
 *     `public/sw/push.js`),
 *   - per-user preferences: categories, quiet hours, priority, digest opt-out
 *     (`lib/social/notification-settings.ts`), + sound/vibration prefs,
 *   - digest generation + the daily cron, admin broadcasts, and delivery
 *     analytics (`lib/social/{digest,broadcasts,push-delivery-stats}.ts`).
 *
 * Every row points at the REAL provider of a capability. The enterprise pieces
 * that genuinely do not exist yet — SMS, native iOS/Android push, Live Activities,
 * a versioned template/approval service, AI summarisation/optimisation, and the
 * concept-stage sources (marketplace, AI studio, cloud sync, orgs) — are
 * `planned`, never implied as done.
 *
 * Same truth rule as the rest of the kernel (docs/CONSTITUTION.md, Article I.3),
 * enforced by `notification-platform.test.ts`: a `live`/`partial` row must point
 * at a file that exists; a `planned` row must not pretend to.
 */

export type NotifStatus =
  /** A declared, load-bearing implementation in code. */
  | "live"
  /** Real and load-bearing, but a subset of the full brief. */
  | "partial"
  /** Named by the brief, not built. Honest placeholder, never implied as done. */
  | "planned";

/** The shared shape every source-backed catalogue row satisfies. */
interface CatalogueEntry {
  id: string;
  /** Repo-relative source of truth. Empty ONLY when `planned`. */
  source: string;
  status: NotifStatus;
}

/* ─────────────────────────────── services ───────────────────────────────────
 * The brief's Backend Architecture list, mapped to the real provider of each
 * capability.
 */

export interface NotifService extends CatalogueEntry {
  name: string;
  capability: string;
  note?: string;
}

export const NOTIFICATION_SERVICES: NotifService[] = [
  { id: "registry", name: "Notification Type Registry", source: "lib/platform/notifications-registry.ts", status: "live", capability: "The single declared source for every notification type — its category, grouping and badge rule; the union/maps are derived from it." },
  { id: "gateway", name: "Notification Gateway", source: "lib/social/notifications.ts", status: "live", capability: "Creates notifications, hydrates actor/post context, lists + groups them, and triggers realtime delivery." },
  { id: "push", name: "Push Service (Web/PWA, VAPID)", source: "lib/push/web-push.ts", status: "live", capability: "Sends Web Push to registered browsers/devices even when the site is closed; prunes dead (410/404) subscriptions on send." },
  { id: "delivery-engine", name: "Delivery Engine (smart push)", source: "lib/notifications/smart-delivery.ts", status: "live", capability: "Every push goes through one path: decide (Attention Engine), record the in-app row WITH the decision, then push or hold." },
  { id: "attention", name: "Attention Engine (Feature 20)", source: "lib/notifications/attention.ts", status: "live", capability: "One pure, tested rule set: critical bypasses all, DND and holding focus modes hold the rest, high ignores quiet hours, medium/low obey quiet hours (member's own zone) and the burst cap, opt-in favourites through quiet hours. Every decision carries reason codes.", note: "Rules, not a model — nothing here learns from behaviour." },
  { id: "delivery-rules", name: "Delivery Rules (Feature 20 Part 5)", source: "lib/notifications/rules.ts", status: "live", capability: "The member's own \"when this, from them → push now / hourly summary / app only\", first match wins, saved tap by tap from the Control Center; read by the Attention Engine. Never applies to security or critical alerts, never breaks through Do Not Disturb or a focus mode.", note: "Stored in notification_settings.rules (0236), at most 30, re-validated by cleanRules on every write." },
  { id: "rule-suggestions", name: "Suggested rules (Feature 20 Part 5)", source: "lib/notifications/suggestions.ts", status: "live", capability: "A group that sent 25+ notifications in the member's last 7 days (never security or messages) is offered as an hourly-summary rule, with the real count, one tap to apply.", note: "A counting rule, not AI — read only when the member taps Check." },
  { id: "lock-screen-privacy", name: "Lock-screen privacy (Feature 20 Part 5)", source: "lib/notifications/rules.ts", status: "live", capability: "Show all / No preview / Hide all — hidden strips the sender, text and photo from the push itself.", note: "0236 lock_screen; before it is applied the old hide_push_preview column still gives No preview." },
  { id: "push-devices", name: "Notification device manager (Feature 20 Part 6)", source: "app/api/push/devices/route.ts", status: "live", capability: "Every push-registered device with a recognisable name, the member's label, its last delivery (sent / retried / failed / expired) and 7-day counts; rename, send a test to that one device, stop notifications there.", note: "Endpoints never leave the server; \"This device\" is matched by a hash computed in the browser." },
  { id: "read-sync", name: "Cross-session read sync (Feature 20 Part 6)", source: "features/notifications/notif-stream.ts", status: "live", capability: "Reading, archiving or clearing on one device sends ONE broadcast on the existing per-member channel; the member's other open sessions refresh their bell and Activity Center.", note: "A broadcast, not row UPDATE events — mark-all-read must not become hundreds of socket messages." },
  { id: "incoming-banner", name: "Incoming in-app banner (Notifications Part 1)", source: "features/notifications/live-toast.tsx", status: "live", capability: "Instagram-style banner while the app is open: the sender's round avatar with a Frenz badge, name, message, \"now\", the post thumbnail; swipe up to dismiss; bursts stack behind the newest; duplicates never re-show; held (DND, focus, quiet hours) → no banner.", note: "Reads the newest five rows to describe a new one — never the history. CSS motion only." },
  { id: "android-badge", name: "Android status-bar badge (Notifications Part 2)", source: "public/badge-96.png", status: "live", capability: "A white F on transparent, so Android's one-colour status-bar silhouette is the Frenz mark instead of a white square.", note: "Push icons are the sender's 192 px avatar render, not the original upload." },
  { id: "suspicious-activity", name: "Suspicious Activity Engine (Feature 20 Part 7)", source: "lib/security/suspicious.ts", status: "live", capability: "Explainable rules over the member's own security log: a sign-in from a new country (30 days), two countries within 6 hours, 5+ failed security checks in an hour, a PIN lockout — each a critical security alert naming the rule and the facts, at most one per rule per 12 h.", note: "Country from the edge header only; no IP lookup, no raw IP stored. Not AI." },
  { id: "alert-authenticity", name: "Notification Authenticity (Feature 20 Part 7)", source: "app/api/security/verify-alert/route.ts", status: "live", capability: "Every security notification carries a reference (FZ-XXXXXXXX) stored on the member's own row; Verify an alert on /account/security confirms a genuine one and calls out a fake.", note: "Trust comes from the account itself (only Frenz can write the row) — not a client-visible signature." },
  { id: "security-timeline", name: "Security timeline (Feature 20 Part 7)", source: "features/account/security-activity.tsx", status: "live", capability: "The append-only audit log with device, approximate country, warning marks, search and paging through the whole history.", note: "Upgraded the existing Recent activity list in place." },
  { id: "phishing-links", name: "Phishing link warnings (Feature 20 Part 7)", source: "lib/security/link-warning.ts", status: "live", capability: "A link in a message or caption that imitates Frenz, uses look-alike characters, is a bare IP or hides its address gets a red warning beside it.", note: "Rules on the URL itself; no lookup service." },
  { id: "inbox-search", name: "Universal Inbox search (Feature 20 Part 3)", source: "lib/notifications/search.ts", status: "live", capability: "Plain-language queries (\"messages from chris last week\") parsed by rules into filters shown back as chips; the loaded list filters instantly and the whole history (archive included) is searched on the server with the same parse.", note: "A parser, not a model — the brief calls it an AI Search Assistant; it is honest about what it is." },
  { id: "smart-actions", name: "Smart Action Engine (Feature 20 Part 4)", source: "lib/notifications/actions.ts", status: "live", capability: "Per-notification actions from what it is: inline Reply for chats (not secret chats), Accept / Decline, Follow back, Block / Ignore, View profile — each an existing endpoint." },
  { id: "rich-identity", name: "Rich identity pushes (Feature 20 Part 4)", source: "lib/push/identity.ts", status: "live", capability: "A push about a person leads with them: name as the title, photo as the icon, the action as the text; system notifications carry the Frenz logo.", note: "iOS web push always shows the app icon (platform rule); Android and desktop show the photo. Animated avatars and 3-second profile videos are not possible in a push." },
  { id: "activity-center", name: "Activity Center (Feature 20)", source: "features/notifications/notification-center.tsx", status: "live", capability: "All, Unread, Priority, Pinned, Held and Archived views, category tabs, text search over who / what / the notification's own words, and a private 'Why this?' per card." },
  { id: "realtime", name: "Realtime Service", source: "features/notifications/notification-center.tsx", status: "live", capability: "Supabase Postgres-changes subscription — the bell and center update instantly, and re-sync on focus/reconnect.", note: "Realtime is the shared Supabase channel; this is the notification consumer of it." },
  { id: "preference", name: "Preference Service", source: "lib/social/notification-settings.ts", status: "live", capability: "Pure gates over a plain settings object: master/push/in-app toggles, per-category prefs, quiet hours, priority, digest opt-out." },
  { id: "subscription", name: "Subscription Service (devices)", source: "lib/push/web-push.ts", status: "live", capability: "Per-device push subscriptions in `push_subscriptions`; multi-device by construction." },
  { id: "email", name: "Email Service", source: "lib/notify.ts", status: "live", capability: "Resend-backed transactional/alert email with a shared HTML builder + once-per-key dedupe.", note: "Operator alerts + digest email today; broad user email campaigns are the planned template/campaign work below." },
  { id: "digest", name: "Digest Service", source: "lib/social/digest.ts", status: "live", capability: "Rolls a day of activity into one Smart Daily Digest, opt-out per user." },
  { id: "scheduling", name: "Scheduling Service", source: "app/api/cron/daily-digest", status: "live", capability: "Cron that runs the digest on a schedule and stamps last-sent per user.", note: "Plus the held summary (deliver later), which rides on the hourly streak run. A general per-notification scheduler is planned." },
  { id: "announcements", name: "Announcement / Campaign Service", source: "lib/social/broadcasts.ts", status: "live", capability: "Admin broadcasts fanned out as `admin_broadcast` notifications to the audience." },
  { id: "analytics", name: "Delivery Analytics", source: "lib/social/push-delivery-stats.ts", status: "live", capability: "Delivery success/failure counts from `push_delivery_log` for the operator dashboard." },
  { id: "monitoring", name: "Delivery Monitoring", source: "features/admin/push-delivery-monitor.tsx", status: "live", capability: "The operator view over push delivery health and recent failures." },
  { id: "admin", name: "Notification Administration", source: "features/admin/broadcast-composer.tsx", status: "live", capability: "Compose + send announcements without a code change." },
  { id: "template", name: "Template Service", source: "lib/notify.ts", status: "partial", capability: "Shared HTML/email + push payload builders with variables.", note: "Real content builders exist; a versioned template registry with preview/approval workflow is planned." },
];

/* ─────────────────────────────── channels ───────────────────────────────────
 * The brief's Supported Channels.
 */

export interface NotifChannel extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const NOTIFICATION_CHANNELS: NotifChannel[] = [
  { id: "in-app", name: "In-app", source: "features/notifications/notification-center.tsx", status: "live", description: "The bell + Notification Center, realtime and grouped." },
  { id: "web-push", name: "Web Push", source: "lib/push/web-push.ts", status: "live", description: "VAPID push to browsers, site closed or open." },
  { id: "pwa-push", name: "PWA Push", source: "public/sw/push.js", status: "live", description: "The installed-app service-worker push handler with action buttons + deep links." },
  { id: "email", name: "Email", source: "lib/notify.ts", status: "live", description: "Resend-backed alert + digest email." },
  { id: "sms", name: "SMS", source: "", status: "planned", description: "Text delivery for high-signal events.", note: "No SMS provider integrated; deferred until a use-case (e.g. 2FA-over-SMS) justifies the cost + consent." },
  { id: "native-ios", name: "Native iOS Push (APNs)", source: "", status: "planned", description: "APNs delivery.", note: "Frenz is a PWA — there is no native iOS app; iOS receives Web Push via the installed PWA today. Audited 2026-10-12 (notifications Part 2): iOS web push always draws the app icon and ignores icon/image, so the sender-photo-with-app-badge look (Communication Notifications, INSendMessageIntent) needs a native app; the in-app banner gives that look instead." },
  { id: "native-android", name: "Native Android Push (FCM)", source: "", status: "planned", description: "FCM delivery.", note: "No native Android source here: the Play Store app is a TWA, which delivers Chrome Web Push. Audited 2026-10-12: Android already shows the sender name as the title, the sender photo as the large icon, the Frenz badge, actions and deep links; MessagingStyle conversations, per-person shortcuts and notification channels need a native (or Flutter) app." },
  { id: "live-activity", name: "Live Activities", source: "", status: "planned", description: "Lock-screen live activities (download progress, etc.).", note: "Native-only iOS capability; not reachable from a PWA." },
];

/* ─────────────────────────────── sources ────────────────────────────────────
 * The brief's Notification Sources. Each live/partial source raises notifications
 * in a declared category (an id in the Notification Type Registry); the
 * concept-stage sources are `planned` with none.
 */

export interface NotifSource {
  id: string;
  label: string;
  /** The NotificationCategory it raises under. Empty ONLY when `planned`. */
  category: string;
  status: NotifStatus;
  note?: string;
}

export const NOTIFICATION_SOURCES: NotifSource[] = [
  { id: "messaging", label: "Messaging", category: "social", status: "live", note: "message / message_reaction / message_mention — own inbox badge, so excluded from the bell count." },
  { id: "friends", label: "Friend requests & follows", category: "social", status: "live" },
  { id: "social-engagement", label: "Likes, comments, mentions, reposts", category: "social", status: "live" },
  { id: "downloads", label: "Downloads", category: "downloads", status: "live", note: "download_complete / failed / ready." },
  { id: "processing", label: "Upload / media processing", category: "downloads", status: "live", note: "processing_finished." },
  { id: "security", label: "Security & account activity", category: "security", status: "live", note: "sign-in, new device, password, 2FA, passkey — bypass quiet hours." },
  { id: "payments", label: "Payments & subscriptions", category: "premium", status: "live" },
  { id: "communities", label: "Communities", category: "community", status: "live", note: "Types are live; the Communities product surface itself is concept-stage in the genome." },
  { id: "moderation", label: "Moderation actions", category: "system", status: "live", note: "post_under_review / appeal_resolved." },
  { id: "news", label: "News & recommendations", category: "news", status: "live" },
  { id: "system", label: "System & maintenance", category: "system", status: "live" },
  { id: "marketplace", label: "Marketplace & orders", category: "", status: "planned", note: "Marketplace is concept-stage in the Product Genome." },
  { id: "ai-studio", label: "AI Studio completions", category: "", status: "planned", note: "No AI generation surface exists yet (the `smart` module is concept-stage)." },
  { id: "cloud-sync", label: "Cloud synchronization", category: "", status: "planned" },
  { id: "org", label: "Organizations & business workspace", category: "", status: "planned" },
];

/* ─────────────────────────── delivery capabilities ──────────────────────────
 * The brief's Real-Time Delivery + Smart Delivery sections, staged honestly.
 */

export type DeliveryKind = "realtime" | "smart";

export interface DeliveryCapability extends CatalogueEntry {
  name: string;
  kind: DeliveryKind;
  description: string;
  note?: string;
}

export const DELIVERY_CAPABILITIES: DeliveryCapability[] = [
  { id: "instant", name: "Instant delivery", kind: "realtime", source: "features/notifications/notification-center.tsx", status: "live", description: "Realtime Postgres-changes push to the bell + center." },
  { id: "retry-prune", name: "Reliable retry / dead-device pruning", kind: "realtime", source: "lib/push/web-push.ts", status: "live", description: "Failed pushes prune 410/404 subscriptions so the next send is clean." },
  { id: "multi-device", name: "Multi-device consistency", kind: "realtime", source: "lib/push/web-push.ts", status: "live", description: "One subscription row per device; a send fans out to all of them." },
  { id: "delivery-ack", name: "Delivery acknowledgements", kind: "realtime", source: "lib/social/push-delivery-stats.ts", status: "live", description: "Every send is logged to `push_delivery_log` for success/failure accounting." },
  { id: "read-state", name: "Read state", kind: "realtime", source: "lib/social/notifications.ts", status: "live", description: "Read/unread per notification, with the bell's unread count." },
  { id: "presence", name: "Presence awareness", kind: "realtime", source: "lib/social/presence/server.ts", status: "partial", description: "Do Not Disturb and focus modes (chosen or scheduled, per time zone) hold pushes; the service worker skips the lock screen while the app is visible on that device.", note: "Choosing ONE device (desktop active → phone silent) is planned — see multi-device-routing." },
  { id: "offline-queue", name: "Offline replay", kind: "realtime", source: "features/notifications/notification-center.tsx", status: "partial", description: "The center refetches on focus/reconnect so nothing is missed while offline.", note: "Web Push already delivers offline; a durable per-notification client queue like the messaging one is not separately built." },
  { id: "quiet-hours", name: "Quiet hours", kind: "smart", source: "lib/social/notification-settings.ts", status: "live", description: "A per-user window (wraps midnight) that holds push, with a security bypass." },
  { id: "priority", name: "Priority classification", kind: "smart", source: "lib/social/notification-settings.ts", status: "live", description: "Security always delivers; per-category `alwaysDeliver` bypasses quiet hours.", note: "Rule-based priority; ML priority scoring is the planned AI item." },
  { id: "dedup", name: "Duplicate suppression", kind: "smart", source: "lib/push/web-push.ts", status: "live", description: "Collapse `tag` — a later push replaces the previous one for the same subject." },
  { id: "bundling", name: "Bundling", kind: "smart", source: "lib/social/notifications.ts", status: "live", description: "The grouped center collapses a burst into one card (\"Sam sent 5 messages\")." },
  { id: "digest", name: "Digest generation", kind: "smart", source: "lib/social/digest.ts", status: "live", description: "A day's activity rolled into one Smart Daily Digest." },
  { id: "context", name: "Context awareness", kind: "smart", source: "lib/social/notification-settings.ts", status: "live", description: "Category prefs + hide-preview shape what is delivered and how it reads." },
  { id: "timezone", name: "Time-zone awareness", kind: "smart", source: "lib/notifications/attention.ts", status: "live", description: "Quiet hours are read in the member's own IANA zone once they save (0233); focus schedules always were.", note: "A window saved before 0233 keeps its UTC reading until the member saves again." },
  { id: "rate-limit", name: "Rate limiting", kind: "smart", source: "lib/notifications/frequency-limit.ts", status: "live", description: "A 30-per-hour burst cap on medium/low pushes; held back pushes stay in-app.", note: "Generous on purpose: a safety net against floods, never a limiter that eats a wanted push." },
  { id: "held-summary", name: "Deliver later (held summary)", kind: "smart", source: "lib/notifications/held-summary.ts", status: "live", description: "Pushes held by DND, a focus mode or quiet hours become ONE summary push when the hold ends — high and medium only, unread only, within 48 h." },
  { id: "explain", name: "Delivery explanation", kind: "smart", source: "lib/notifications/explain.ts", status: "live", description: "Each recorded decision is said in one private sentence on the member's own card ('Held because Sleep focus was on')." },
  { id: "multi-device-routing", name: "Active-device routing", kind: "smart", source: "", status: "planned", description: "Send to the device in use and keep the others silent.", note: "Needs a trustworthy per-device live-session signal; the owner's rule is never to gate a working push on a signal not yet seen to be true." },
  { id: "interruption-protection", name: "Interruption protection", kind: "smart", source: "", status: "planned", description: "Hold during calls, screen recording, gaming, video, navigation.", note: "A web page can't observe these; the Gaming, Driving and Meeting focus modes are the honest equivalent today." },
  { id: "escalation", name: "Escalation", kind: "smart", source: "", status: "planned", description: "Silent → reminder → higher priority → emergency contact.", note: "Needs a consented emergency-contact model and SMS; neither exists." },
  { id: "device-context", name: "Battery / network / location-aware delivery", kind: "smart", source: "", status: "planned", description: "Adapt delivery to battery, network and place.", note: "Not reliably exposed to the web; location would cost privacy for little gain." },
];

/* ─────────────────────────────── preferences ────────────────────────────────
 * The brief's Personalization section.
 */

export interface NotifPreference extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const NOTIFICATION_PREFERENCES: NotifPreference[] = [
  { id: "categories", name: "Category preferences", source: "lib/social/notification-settings.ts", status: "live", description: "Per-category enable + push toggles (see in-app but not buzz, or neither)." },
  { id: "master", name: "Master / push / in-app toggles", source: "lib/social/notification-settings.ts", status: "live", description: "Three independent kill switches." },
  { id: "quiet-hours", name: "Quiet hours", source: "lib/social/notification-settings.ts", status: "live", description: "One real window, midnight-wrapping, with a security bypass." },
  { id: "hide-preview", name: "Hide push preview", source: "lib/social/notification-settings.ts", status: "live", description: "Deliver the push without the message contents on the lock screen." },
  { id: "digest", name: "Digest opt-out", source: "lib/social/notification-settings.ts", status: "live", description: "Opt out of the Smart Daily Digest." },
  { id: "sound", name: "Sound preferences", source: "lib/social/notification-sound-prefs.ts", status: "live", description: "Foreground interaction sounds, per-device.", note: "A web app can't set the OS push sound on iOS/Android — this is the in-app sound." },
  { id: "vibration", name: "Vibration preferences", source: "lib/social/notification-sound-prefs.ts", status: "live", description: "Foreground haptics." },
  { id: "language", name: "Language", source: "lib/i18n", status: "partial", description: "Notification copy follows the app locale.", note: "Static i18n catalogue; per-recipient language selection for delivery is not yet wired." },
  { id: "schedules", name: "Named schedules", source: "lib/social/presence/engine.ts", status: "live", description: "Focus modes (Sleep, Meeting, Driving, Personal time, Vacation…) on day/time schedules in the member's zone; the holding ones hold pushes.", note: "Calendar- and location-triggered activation is planned." },
  { id: "labels", name: "Private labels", source: "lib/notifications/search.ts", status: "live", description: "Up to five private labels per notification (the brief's custom categories and labels, as one concept), filterable and searchable by name (0234)." },
  { id: "layout", name: "Cards / Compact / Timeline", source: "features/notifications/notification-center.tsx", status: "live", description: "Three layouts, remembered on the device; the timeline groups by day.", note: "A calendar view is planned." },
  { id: "smart-delivery", name: "Smart delivery switches", source: "lib/social/notification-settings.ts", status: "live", description: "Catch me up when a hold ends (default on); favourites can reach me in quiet hours (default off, never through DND or focus)." },
];

/* ─────────────────────────────── AI (Delivery Intelligence) ──────────────────
 * The brief's AI Platform Integration. None of this is built — smart delivery
 * today is rule-based (preferences + quiet hours + digest), which is honest and
 * effective. Each row is `planned`, not implied.
 */

export interface NotifAiCapability extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const NOTIFICATION_AI: NotifAiCapability[] = [
  { id: "summarization", name: "Notification summarization", source: "", status: "planned", description: "AI-condensed \"here's what you missed\".", note: "A rule-based summary (counts by kind) is live as the held summary and the daily digest; neither is AI and neither says it is." },
  { id: "priority-ml", name: "ML priority classification", source: "", status: "planned", description: "Learned importance scoring beyond the rule-based security bypass." },
  { id: "personalization", name: "Personalized timing", source: "", status: "planned", description: "Per-user best-time-to-send from engagement history." },
  { id: "language-adaptation", name: "Language adaptation", source: "", status: "planned", description: "On-the-fly translation of notification copy per recipient." },
  { id: "delivery-optimization", name: "Delivery optimization", source: "", status: "planned", description: "ML routing/throttling to maximise engagement without fatigue." },
  { id: "content-quality", name: "Content quality", source: "", status: "planned", description: "AI review of announcement copy before send." },
];

/* ─────────────────────────────────── reads ──────────────────────────────────── */

export function getNotificationServices(): NotifService[] {
  return NOTIFICATION_SERVICES;
}
export function getNotificationChannels(): NotifChannel[] {
  return NOTIFICATION_CHANNELS;
}
export function getNotificationSources(): NotifSource[] {
  return NOTIFICATION_SOURCES;
}
export function getDeliveryCapabilities(): DeliveryCapability[] {
  return DELIVERY_CAPABILITIES;
}
export function getNotificationPreferences(): NotifPreference[] {
  return NOTIFICATION_PREFERENCES;
}
export function getNotificationAi(): NotifAiCapability[] {
  return NOTIFICATION_AI;
}

/** Everything source-backed, for the platform-health summary + teeth. */
export function notificationPlatformEntries(): CatalogueEntry[] {
  return [
    ...NOTIFICATION_SERVICES,
    ...NOTIFICATION_CHANNELS,
    ...DELIVERY_CAPABILITIES,
    ...NOTIFICATION_PREFERENCES,
    ...NOTIFICATION_AI,
  ];
}

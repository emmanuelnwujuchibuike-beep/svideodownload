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
  { id: "delivery-engine", name: "Delivery Engine (smart push)", source: "lib/push/social-push.ts", status: "live", capability: "Per-event push that applies the recipient's preferences (category, quiet hours, priority) before delivering." },
  { id: "realtime", name: "Realtime Service", source: "features/notifications/notification-center.tsx", status: "live", capability: "Supabase Postgres-changes subscription — the bell and center update instantly, and re-sync on focus/reconnect.", note: "Realtime is the shared Supabase channel; this is the notification consumer of it." },
  { id: "preference", name: "Preference Service", source: "lib/social/notification-settings.ts", status: "live", capability: "Pure gates over a plain settings object: master/push/in-app toggles, per-category prefs, quiet hours, priority, digest opt-out." },
  { id: "subscription", name: "Subscription Service (devices)", source: "lib/push/web-push.ts", status: "live", capability: "Per-device push subscriptions in `push_subscriptions`; multi-device by construction." },
  { id: "email", name: "Email Service", source: "lib/notify.ts", status: "live", capability: "Resend-backed transactional/alert email with a shared HTML builder + once-per-key dedupe.", note: "Operator alerts + digest email today; broad user email campaigns are the planned template/campaign work below." },
  { id: "digest", name: "Digest Service", source: "lib/social/digest.ts", status: "live", capability: "Rolls a day of activity into one Smart Daily Digest, opt-out per user." },
  { id: "scheduling", name: "Scheduling Service", source: "app/api/cron/daily-digest", status: "live", capability: "Cron that runs the digest on a schedule and stamps last-sent per user.", note: "One scheduled job today (the digest); a general per-notification scheduler is planned." },
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
  { id: "native-ios", name: "Native iOS Push (APNs)", source: "", status: "planned", description: "APNs delivery.", note: "Frenz is a PWA — there is no native iOS app; iOS receives Web Push via the installed PWA today." },
  { id: "native-android", name: "Native Android Push (FCM)", source: "", status: "planned", description: "FCM delivery.", note: "No native Android app; Android receives Web Push via the installed PWA today." },
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
  { id: "presence", name: "Presence awareness", kind: "realtime", source: "app/api/presence-status/route.ts", status: "partial", description: "Presence/last-active is tracked.", note: "Used for the social presence dots; not yet a routing input that suppresses push while a user is actively in-app." },
  { id: "offline-queue", name: "Offline replay", kind: "realtime", source: "features/notifications/notification-center.tsx", status: "partial", description: "The center refetches on focus/reconnect so nothing is missed while offline.", note: "Web Push already delivers offline; a durable per-notification client queue like the messaging one is not separately built." },
  { id: "quiet-hours", name: "Quiet hours", kind: "smart", source: "lib/social/notification-settings.ts", status: "live", description: "A per-user window (wraps midnight) that holds push, with a security bypass." },
  { id: "priority", name: "Priority classification", kind: "smart", source: "lib/social/notification-settings.ts", status: "live", description: "Security always delivers; per-category `alwaysDeliver` bypasses quiet hours.", note: "Rule-based priority; ML priority scoring is the planned AI item." },
  { id: "dedup", name: "Duplicate suppression", kind: "smart", source: "lib/push/web-push.ts", status: "live", description: "Collapse `tag` — a later push replaces the previous one for the same subject." },
  { id: "bundling", name: "Bundling", kind: "smart", source: "lib/social/notifications.ts", status: "live", description: "The grouped center collapses a burst into one card (\"Sam sent 5 messages\")." },
  { id: "digest", name: "Digest generation", kind: "smart", source: "lib/social/digest.ts", status: "live", description: "A day's activity rolled into one Smart Daily Digest." },
  { id: "context", name: "Context awareness", kind: "smart", source: "lib/social/notification-settings.ts", status: "live", description: "Category prefs + hide-preview shape what is delivered and how it reads." },
  { id: "timezone", name: "Time-zone awareness", kind: "smart", source: "lib/social/notification-settings.ts", status: "partial", description: "Quiet-hours are evaluated against the hour window.", note: "Windows are stored in UTC hours; true per-user local-time targeting needs a stored timezone." },
  { id: "rate-limit", name: "Rate limiting", kind: "smart", source: "", status: "planned", description: "A hard per-user delivery cap over a rolling window.", note: "Grouping + digest + quiet-hours reduce volume today; a dedicated rate-limiter is not built." },
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
  { id: "schedules", name: "Named schedules", source: "", status: "planned", description: "Multiple named quiet-hours schedules (Sleep/Work/Gym).", note: "One window is the honestly-buildable core; named schedules + calendar/location activation are deferred." },
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
  { id: "summarization", name: "Notification summarization", source: "", status: "planned", description: "AI-condensed \"here's what you missed\"." },
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

/**
 * Data Domain Registry — the Enterprise Data Platform's map of the database.
 *
 * The brief's "Data Domains": every table this platform owns, grouped into a domain
 * with a single clear owner and a storage strategy. It is a CATALOGUE over the real
 * schema — the migrations in `supabase/migrations/` remain the authority — kept from
 * drifting by `data-domains.test.ts`, which asserts (a) every table named here exists
 * in a migration, and (b) every migration table is catalogued exactly once (clear
 * ownership, no orphans). So a new table without a home fails the suite.
 */

export type StorageKind =
  | "relational" // Supabase Postgres
  | "object" // Cloudflare R2 / Supabase Storage
  | "cache" // Upstash Redis
  | "search" // the cross-surface index
  | "event-log"; // the append-only events stream

export interface DataDomain {
  id: string;
  name: string;
  /** The module/lib that owns this domain's writes. */
  owner: string;
  description: string;
  /** Principal tables (each must exist in a migration, each owned by ONE domain). */
  tables: readonly string[];
  storage: StorageKind[];
}

export const DATA_DOMAINS: DataDomain[] = [
  {
    id: "identity",
    name: "Identity",
    owner: "lib/auth, lib/security",
    description: "Accounts, profiles and every authentication/authorisation factor.",
    tables: [
      "profiles",
      "account_security_settings",
      "security_pin",
      "mfa_recovery_codes",
      "webauthn_credentials",
      "webauthn_challenges",
      "trusted_devices",
      "user_encryption_keys",
      "privacy_settings",
    ],
    storage: ["relational"],
  },
  {
    id: "social",
    name: "Social",
    owner: "lib/social",
    description: "Posts, reels, stories, engagement and the social graph.",
    tables: [
      "posts",
      "post_media",
      "post_comments",
      "post_reactions",
      "post_polls",
      "poll_options",
      "poll_votes",
      "post_views",
      "post_guest_likes",
      "comment_reactions",
      "reposts",
      "follows",
      "friendships",
      "friend_requests",
      "friend_favorites",
      "blocks",
      "muted_creators",
      "collections",
      "collection_items",
      "stories",
      "user_stickers",
      "user_home_preferences",
      "user_presence_status",
      "user_restrictions",
    ],
    storage: ["relational", "object"],
  },
  {
    id: "messaging",
    name: "Messaging",
    owner: "lib/social (messages)",
    description: "Conversations, messages, attachments and chat state.",
    tables: [
      "conversations",
      "conversation_members",
      "messages",
      "message_attachments",
      "message_reactions",
      "message_polls",
      "message_poll_votes",
      "message_send_failures",
      "starred_messages",
      "chat_appearance_preferences",
    ],
    storage: ["relational", "object"],
  },
  {
    id: "media",
    name: "Media & Downloads",
    owner: "lib/media, lib/storage",
    description: "Extracted/stored media, streaming assets and the download ledger.",
    tables: ["media_assets", "asset_usage", "downloads", "download_events"],
    storage: ["relational", "object"],
  },
  {
    id: "monetization",
    name: "Monetization",
    owner: "lib/monetization, lib/paystack",
    description: "Subscriptions, ads, affiliates, API access and offer gateways.",
    tables: [
      "subscriptions",
      "ads",
      "ad_clicks",
      "ad_impressions",
      "affiliate_offers",
      "affiliate_clicks",
      "api_keys",
      "api_usage",
      "product_waitlist",
      "gateway_config",
      "gateway_impressions",
    ],
    storage: ["relational"],
  },
  {
    id: "moderation",
    name: "Trust & Moderation",
    owner: "lib/moderation",
    description: "Reports, AI assessments, appeals and operator alerts.",
    tables: ["reports", "moderation_ai_assessments", "moderation_appeals", "admin_alerts"],
    storage: ["relational"],
  },
  {
    id: "notifications",
    name: "Notifications",
    owner: "lib/social (notifications), lib/push",
    description: "Notifications, per-category settings, broadcasts and push delivery.",
    tables: [
      "notifications",
      "notification_settings",
      "notification_sound_prefs",
      "notification_broadcasts",
      "push_subscriptions",
      "push_delivery_log",
      "milestone_log",
    ],
    storage: ["relational"],
  },
  {
    id: "content",
    name: "Content & Knowledge",
    owner: "lib/content",
    description: "The living content platform: authored items, versions, workflows and the genome graph.",
    tables: [
      "content_items",
      "content_versions",
      "content_schedules",
      "content_audit_log",
      "content_workflow_runs",
      "editorial_workflows",
      "editorial_comments",
      "workflow_stages",
      "stage_results",
      "publications",
      "product_genomes",
      "graph_edges",
      "compile_runs",
      "sync_findings",
      "schema_repairs",
      "link_health",
    ],
    storage: ["relational"],
  },
  {
    id: "learning",
    name: "Learning",
    owner: "lib/learning, lib/academy",
    description: "Course progress and the personal learning plane.",
    tables: ["learning_progress", "personal_learning_items"],
    storage: ["relational"],
  },
  {
    id: "localization",
    name: "Localization",
    owner: "lib/i18n",
    description: "Locales and the translation catalogue.",
    tables: ["locales", "translations"],
    storage: ["relational", "search"],
  },
  {
    id: "analytics",
    name: "Analytics",
    owner: "lib/analytics",
    description: "The unified event stream and derived traffic/engagement rollups.",
    tables: ["events", "analytics", "traffic_logs", "platform_stats"],
    storage: ["relational", "event-log"],
  },
  {
    id: "configuration",
    name: "Configuration",
    owner: "lib/platform",
    description: "Runtime configuration: feature flags, experiments, global settings and the config change log.",
    tables: ["feature_flags", "experiments", "settings", "config_audit_log"],
    storage: ["relational", "cache"],
  },
  {
    id: "audit",
    name: "Audit",
    owner: "lib/security",
    description: "The immutable security audit trail.",
    tables: ["security_audit_log"],
    storage: ["relational"],
  },
];

export function getDataDomains(): DataDomain[] {
  return DATA_DOMAINS;
}

/** Every catalogued table, flattened. */
export function allCatalogedTables(): string[] {
  return DATA_DOMAINS.flatMap((d) => d.tables);
}

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
      // What a repost actually caused — impressions, opens and onward reposts,
      // one row per (repost, actor, event). Feature 15 Part 4, migration 0116.
      "repost_attributions",
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
    id: "life-memories",
    name: "Life Memories",
    owner: "lib/social (time-capsules, journal)",
    description: "Time Capsule™ and the Private Journal — sealed/private planes over a member's own life story, never shown to anyone else.",
    tables: ["time_capsules", "journal_entries"],
    storage: ["relational"],
  },
  {
    id: "profile-platform",
    name: "Universal Profile Platform",
    owner: "lib/profile, lib/social (profile-platform)",
    description:
      "The Universal Profile Engine™: which modules a profile shows and to whom, plus the content those modules read — singular details (headline, mission, hours, contact), the professional showcase (experience, education, certifications, awards, publications, projects) and the business catalogue (products, services). The profile TYPE itself is a column on `profiles`, which the Identity domain owns — one identity, never a second row.",
    tables: [
      "profile_modules",
      "profile_details",
      "profile_credentials",
      "profile_offerings",
      "profile_appearance",
      // Migration 0110 — the backends Parts 14-16 declared but hadn't built.
      "profile_featured",
      "profile_events",
      "profile_event_rsvps",
      "profile_team_members",
      "profile_reviews",
      "profile_membership_tiers",
      "profile_repositories",
      "profile_spaces",
      "profile_widgets",
      "profile_goals",
      "profile_snapshots",
      "profile_view_stats",
      // Migration 0114 — layout version history.
      "profile_versions",
    ],
    storage: ["relational"],
  },
  {
    id: "social-graph",
    name: "Social Graph",
    owner: "lib/social/graph",
    description:
      "The Social Graph™ OVERLAY (migration 0112). It deliberately owns no edges: follows, friendships, requests, favourites, blocks, mutes and restrictions all belong to the Social domain and stay the single source of truth. What lives here is what did not exist before — a member's PRIVATE annotation on an edge (a relationship label), their private groupings of edges (circles and their membership), and a record of who matters (trusted contacts, which grant no access). Every table is readable only by the person who created the row, never by the person it is about.",
    tables: ["relationship_labels", "social_circles", "circle_members", "trusted_contacts"],
    storage: ["relational"],
  },
  {
    id: "discovery",
    name: "Profile Discovery",
    owner: "lib/discovery, lib/social/profile-search",
    description:
      "Who can be FOUND, and by what (migration 0113). Per-member discoverability with a per-FIELD opt-in — city and country are off by default, because being findable by name is what a profile is for while being findable by location is a separate consent. Private bookmarks of other people (never disclosed to them), plus discovery analytics kept as DAILY AGGREGATES: a row per search would be the highest-write table here and would record who looked for whom, so counters answer the owner's question while storing nothing about any searcher. `profile_search_terms` has no column that could hold a searcher id.",
    tables: [
      "profile_discovery",
      "profile_bookmarks",
      "profile_bookmark_lists",
      "profile_discovery_stats",
      "profile_search_terms",
    ],
    storage: ["relational"],
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
    id: "feedback",
    name: "Feedback",
    owner: "lib/notify, features/feedback",
    description:
      "App ratings, asked after two successful downloads and again no sooner than a fortnight later. Guests can rate — the downloader needs no account, so requiring one would collect feedback only from the least representative group — which is why the row carries a nullable user_id alongside the analytics visitor id.",
    tables: ["app_ratings"],
    storage: ["relational"],
  },
  {
    id: "support",
    name: "Support",
    owner: "lib/support",
    description: "1:1 support conversations between members and the admin team — one running thread per member and its messages.",
    tables: ["support_threads", "support_messages"],
    storage: ["relational"],
  },
  {
    id: "wallpapers",
    name: "Wallpapers",
    owner: "lib/wallpapers",
    description:
      "The admin-curated wallpaper library and its real engagement — likes, private saves and comments. Counters are trigger-maintained on the row so a grid of cards costs one query, not one per card. Images live in the public wallpapers bucket.",
    tables: ["wallpapers", "wallpaper_likes", "wallpaper_saves", "wallpaper_comments"],
    storage: ["relational", "object"],
  },
  {
    id: "verification",
    name: "Account Verification",
    owner: "lib/social/verification",
    description:
      "Blue-tick applications: the identity check, its decision and an append-only audit trail. Document images live in the PRIVATE verification-docs bucket and are only ever reached through short-lived signed URLs.",
    tables: ["verification_requests", "verification_events"],
    storage: ["relational", "object"],
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
    description:
      "The unified event stream and derived traffic/engagement rollups, plus the enterprise analytics event pipeline: an append-only, exactly-once event log (analytics_events) and a canonical per-download record (analytics_downloads) for accurate, dedup-safe counting.",
    tables: ["events", "analytics", "traffic_logs", "platform_stats", "analytics_events", "analytics_downloads"],
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

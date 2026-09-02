import { exportableDomains } from "./registry";

/**
 * Which column ties each row to a person — and which tables must never be
 * exported at all.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * `registry.ts` decides which DOMAINS a member may take with them. That is not
 * enough to actually build an export, because every table names its owner
 * differently: `publisher_id`, `author_id`, `follower_id`, `owner_id`,
 * `muter_id`, or just `id`. A generic exporter has to be told.
 *
 * Every entry below was READ OUT OF THE MIGRATIONS rather than guessed — each
 * one is a column with a real `references auth.users` foreign key. Guessing
 * here does not fail loudly; it either returns nothing (a silently empty
 * section) or, far worse, returns somebody else's rows.
 *
 * ── The two lists are exhaustive, and that is the point ──────────────────────
 * Every table in every exportable domain appears in exactly one of `OWNER_COLUMN`
 * or `NOT_EXPORTED`, and `tables.test.ts` fails when one appears in neither.
 * That is what makes the export's completeness structural: a new table lands in
 * a catalogued domain, the test goes red, and somebody has to make a decision
 * about it. The old hand-written export could not fail that way, which is how it
 * came to cover nine tables out of ninety-four.
 */

/**
 * 🔴 Material that must NEVER leave the server, even to its owner.
 *
 * This is the most important list in the file. An account export is a plain
 * file that lands in a Downloads folder, gets synced to a cloud drive, and is
 * sometimes forwarded to whoever asked for it. Recovery codes, encryption keys
 * and PIN material in that file turn a data-portability feature into a
 * credential-disclosure feature — the request is legitimate and the outcome is
 * a compromised account.
 *
 * "It is their own data" is true and is not the test. The test is whether
 * handing it over in this form makes them safer or less safe.
 */
export const SECRET_TABLES: Record<string, string> = {
  mfa_recovery_codes: "One-time codes that bypass two-factor sign-in. Exporting them would put working account keys in a file.",
  security_pin: "Your PIN material. The same reasoning as recovery codes.",
  user_encryption_keys: "Private keys for end-to-end encrypted chats. Exporting them would let anyone holding the file read those conversations.",
  webauthn_credentials: "Passkey material, which is bound to the device that holds it and is meaningless — and dangerous — anywhere else.",
  webauthn_challenges: "Short-lived sign-in challenges. They expire in minutes and mean nothing outside a live sign-in.",
};

/**
 * Tables in an exportable domain that are still not exported, with the reason.
 *
 * Every reason is shown to the person in the export's own coverage report, so
 * they can see exactly what they did and did not receive. A gap they can read
 * is a very different thing from a gap they cannot.
 */
export const NOT_EXPORTED: Record<string, string> = {
  ...SECRET_TABLES,

  /* Not about any individual — reference rows inside a personal domain. */
  ads: "Ad inventory. Not personal data.",
  affiliate_offers: "Affiliate catalogue. Not personal data.",
  media_assets: "Shared media records, not owned by one member.",
  asset_usage: "Links assets to places they appear. Not personal data.",
  post_media: "Attachments belonging to a post; the post itself is exported.",
  poll_options: "Options belonging to a poll; the poll itself is exported.",
  /* Rows belonging to a streak, keyed by `streak_id` rather than by a person —
     the same shape as `post_media` above. The streak itself IS exported, and it
     carries the summary these rows produce (current run, longest run, total
     active days, start date). Their remaining purpose is idempotency: the
     composite primary key is what stops a day being credited twice. */
  streak_daily_activity:
    "Per-day credit ledger belonging to a streak; the streak itself is exported, including the totals these rows produce.",
  /* Same shape and same reasoning as the ledger above: keyed by `streak_id`,
     not by a person, and every fact in it is about a streak that is itself
     exported. It exists so the admin dashboard can answer "how many days were
     lost and restored" — `streaks` overwrites `current_streak` on a break, so
     the length of the ended run survives nowhere else. */
  /* Operational security telemetry about SIGN-IN ATTEMPTS, keyed by email or IP
     rather than by an account — a row exists for addresses that never had one.
     Exporting it would hand anyone who asks a list of which addresses have been
     probed, which is exactly the information the table exists to act on. */
  admin_login_attempts:
    "Failed administrator sign-in attempts, used only to slow password guessing. Not personal data about a member and not tied to an account.",
  streak_events:
    "Record of your streaks ending and being restored, belonging to a streak; the streak itself is exported, including its current and longest run.",
  collection_items: "Membership rows for a collection; the collection is exported.",
  gateway_config: "Payment gateway configuration. Operational, not personal.",
  notification_broadcasts: "Announcements sent to everyone. Not about you.",
  product_waitlist: "Interest in unreleased products; exported with your profile instead.",
  batch_sessions: "One row per Multi-Link batch you ran today, used only to count your daily allowance. It holds no links, no files and nothing about what you downloaded — the downloads themselves are exported through your download history.",
  reward_sessions: "Short-lived reward-download authorizations. They expire in minutes and mean nothing once redeemed; the download itself is exported through your download history.",

  /*
    Rows ABOUT you that were written BY someone else. Real personal data, and
    still not ours to hand over in bulk: exporting them would disclose other
    people's actions to you in a form they never agreed to.
  */
  post_views: "Who viewed your posts. Exporting it would identify other people's browsing.",
  post_watch_events: "Who watched your posts and for how long. Same reasoning as post_views — exporting it would identify other people's watch behavior; the aggregate (completion_rate) is already exported through posts.",
  sound_plays: "Who played your sounds. Same reasoning as post_views — the total is already exported through sounds.plays_count.",
  post_guest_likes: "Anonymous likes on your posts. There is no identity to return.",
  profile_view_stats: "Aggregate view counts, not a list of viewers.",
  profile_discovery_stats: "Aggregate discovery counts.",

  /*
    Genuinely ambiguous ownership — a symmetric row where neither column is
    "yours". Reported as not exported rather than exported with a coin-flip.
  */
  friendships: "A friendship is one row shared by two people; neither side owns it alone. Your friend list is exported through friend_requests and friend_favorites.",
  user_restrictions: "A restriction is a relationship between two accounts; the half you set is exported through blocks and muted_creators.",
};

/**
 * table → the column holding the owner's user id.
 *
 * Where a table references `auth.users` twice, the column chosen is the one
 * that means "this row is MINE" rather than "this row is ABOUT me", and the
 * choice is noted. `follows` is exported twice, from both sides, because who
 * you follow and who follows you are both facts about you and both are already
 * visible to you in the product.
 */
export const OWNER_COLUMN: Record<string, string> = {
  /* identity */
  profiles: "id",
  account_security_settings: "user_id",
  trusted_devices: "user_id",
  privacy_settings: "user_id",

  /* social */
  posts: "publisher_id",
  post_comments: "author_id",
  post_reactions: "user_id",
  post_polls: "owner_id",
  poll_votes: "user_id",
  comment_reactions: "user_id",
  comment_muted_users: "creator_id",
  reposts: "user_id",
  // Keyed on ACTOR, not on whose repost it was. A member is entitled to the
  // record of what they themselves saw, opened and engaged with; the mirror
  // direction ("everyone who saw your repost") is deliberately not exportable,
  // for the same reason `post_views` is excluded below — it would hand one
  // member a list of other people's browsing. Reach stays a number everywhere,
  // including here.
  repost_attributions: "actor_id",
  // Keyed on the sharer, same reasoning as `reposts` above — a member is
  // entitled to a record of what THEY shared, not a list of everyone who
  // shared their own posts (that stays a count, via posts.shares_count).
  share_events: "sharer_id",
  sounds: "created_by",
  stories: "user_id",
  // follower_id = accounts you chose to follow. The other side is exported
  // separately as `followers`, see FOLLOW_MIRROR.
  follows: "follower_id",
  blocks: "blocker_id",
  muted_creators: "muter_id",

  /* life memories */
  time_capsules: "user_id",
  journal_entries: "user_id",

  /* profile platform */
  profile_modules: "user_id",
  profile_details: "user_id",
  profile_credentials: "user_id",
  profile_offerings: "user_id",
  profile_widgets: "user_id",
  profile_spaces: "user_id",
  profile_featured: "user_id",
  profile_goals: "user_id",
  profile_events: "user_id",
  profile_event_rsvps: "user_id",
  profile_membership_tiers: "user_id",
  profile_repositories: "user_id",
  profile_snapshots: "user_id",
  profile_versions: "user_id",
  profile_appearance: "user_id",
  profile_search_terms: "user_id",
  // Reviews you WROTE. Reviews written about you are the reviewer's words.
  profile_reviews: "author_id",
  profile_team_members: "user_id",

  /* social graph */
  relationship_labels: "owner_id",
  social_circles: "owner_id",
  circle_members: "owner_id",
  trusted_contacts: "owner_id",
  friend_requests: "sender_id",
  friend_favorites: "user_id",

  /* discovery */
  profile_discovery: "user_id",
  profile_bookmarks: "owner_id",
  profile_bookmark_lists: "owner_id",
  collections: "user_id",

  /* media & downloads */
  downloads: "user_id",
  download_events: "user_id",

  /* monetization */
  subscriptions: "user_id",
  ad_clicks: "user_id",
  ad_impressions: "user_id",
  affiliate_clicks: "user_id",
  gateway_impressions: "user_id",
  api_keys: "user_id",
  api_usage: "user_id",

  /* feedback & support */
  app_ratings: "user_id",
  support_threads: "user_id",
  support_messages: "sender_id",

  /* wallpapers */
  wallpapers: "uploaded_by",
  wallpaper_likes: "user_id",
  wallpaper_saves: "user_id",
  wallpaper_comments: "user_id",

  /* notifications */
  notifications: "user_id",
  notification_settings: "user_id",
  notification_sound_prefs: "user_id",
  /* Keyed on `viewer_id` — the person whose export this is, and whose choice
     the row records. Deliberately NOT `target_id`: exporting rows where you are
     the TARGET would hand someone a list of who has notifications switched on
     for them, which is other people's data, not theirs. */
  creator_notification_prefs: "viewer_id",
  push_subscriptions: "user_id",
  push_delivery_log: "user_id",

  /* streaks */
  /* Keyed on `user_id`, which also means an ANONYMOUS streak is not exportable
     — correctly so: an anonymous row is addressed only by an httpOnly cookie,
     and there is no verified person to hand it to. It becomes exportable the
     moment it is merged into an account (lib/streaks/engine.ts). */
  streaks: "user_id",

  /* learning */
  learning_progress: "user_id",
  personal_learning_items: "user_id",

  /* audit + misc personal state */
  security_audit_log: "user_id",
  milestone_log: "user_id",
  user_home_preferences: "user_id",
  // FrenzDNA™ — the viewer's own derived interest weights (Feature 15 Part 8).
  user_interest_profile: "user_id",
  user_presence_status: "user_id",
  user_stickers: "user_id",

  /* Creator Studio™ (Feature 15 Part 9, migration 0140) */
  // The dashboard layout they arranged — entirely their own choices.
  creator_studio_prefs: "user_id",
  // Their calendar: ideas, campaigns and launches they wrote down. As personal
  // as a note, and nobody else's data appears in it.
  content_plan: "user_id",
  /*
    Collaborations they were invited INTO, keyed by the invitee.

    `user_id` rather than `invited_by`: this is the row that says "you worked on
    this post", which is the collaborator's own record of their own work. It
    names whoever invited them, and that is the same shape as `follows` — a
    deliberate, mutually-known approach from another member, not an observation
    about them. The mirror side (people YOU invited) is reachable from the posts
    you own, which are already exported.
  */
  post_collaborators: "user_id",
};

/**
 * The one table exported from BOTH sides.
 *
 * Who you follow and who follows you are two different facts and a person
 * expects both. Kept as an explicit exception rather than a general "export
 * every FK" rule, which would drag in everyone who blocked you.
 */
export const FOLLOW_MIRROR = { table: "follows", column: "following_id", as: "followers" } as const;

export interface ExportPlan {
  /** table → owner column, for everything that will be read. */
  included: { table: string; column: string }[];
  /** table → why it was left out, shown to the person in the file. */
  excluded: { table: string; reason: string }[];
  /** Tables in an exportable domain with no decision at all. Must be empty. */
  undecided: string[];
}

/**
 * What an export will actually cover, derived from the domain catalogue.
 *
 * The export route reads this rather than a list of its own, so adding a table
 * to a catalogued domain changes the export without anybody editing the route.
 */
export function exportPlan(): ExportPlan {
  const included: ExportPlan["included"] = [];
  const excluded: ExportPlan["excluded"] = [];
  const undecided: string[] = [];

  for (const domain of exportableDomains()) {
    for (const table of domain.tables) {
      const column = OWNER_COLUMN[table];
      if (column) {
        included.push({ table, column });
        continue;
      }
      const reason = NOT_EXPORTED[table];
      if (reason) {
        excluded.push({ table, reason });
        continue;
      }
      undecided.push(table);
    }
  }

  included.sort((a, b) => a.table.localeCompare(b.table));
  excluded.sort((a, b) => a.table.localeCompare(b.table));
  return { included, excluded, undecided: undecided.sort() };
}

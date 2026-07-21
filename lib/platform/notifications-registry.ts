/**
 * Notification Registry — the single declared source for every notification the
 * platform can raise. The brief's "Notification Registry™", made real.
 *
 * ── Why this exists / what it consolidates ────────────────────────────────────
 *
 * Notification behaviour used to live in FOUR parallel structures in
 * `lib/social/notifications.ts`: a `NotificationType` union, a `CATEGORY_BY_TYPE`
 * map, three grouping `Set`s, and a badge-exclusion list. Adding a type meant
 * editing four places and hoping they agreed. This registry is now the one place;
 * the union, the category map, the grouping sets and the badge rule are all
 * DERIVED from it, and `notifications.ts` re-exports them so no caller changed.
 *
 * Behaviour is preserved exactly (pinned by `notifications-registry.test.ts`),
 * including the two deliberate quirks that were previously implicit:
 *   - `system` / `admin_broadcast` are `categoryMutable: false` — muting a category
 *     never hides them (they were simply omitted from the old map).
 *   - `message` / `message_reaction` are `countsToBadge: false` — they have their
 *     own inbox badge, so they don't inflate the bell's number.
 *
 * The DB `type` check constraint (migrations 0018/0059) is the storage-side mirror;
 * keep them in step when adding a type.
 */

/** Notification Center tab categories. */
export type NotificationCategory =
  | "social"
  | "downloads"
  | "community"
  | "news"
  | "premium"
  | "security"
  | "system";

/** How the Notification Center collapses duplicates for a type. */
export type NotificationGroupBy = "post" | "together" | "conversation";

export interface NotificationDef {
  /** Stable snake_case id — the `type` stored in the notifications table. */
  id: string;
  /** Short human label. */
  label: string;
  category: NotificationCategory;
  /** Collapse rule in the grouped view. Omitted ⇒ not collapsed (grouped by id). */
  group?: NotificationGroupBy;
  /** Counts toward the topbar bell's numeric badge. Default true. */
  countsToBadge?: boolean;
  /** Can category muting hide it in-app? Default true. */
  categoryMutable?: boolean;
}

export const NOTIFICATIONS = [
  /* ── social ── */
  { id: "follow", label: "Followed you", category: "social", group: "together" },
  { id: "like", label: "Liked your post", category: "social", group: "post" },
  { id: "love", label: "Loved your post", category: "social", group: "post" },
  { id: "comment", label: "Commented", category: "social", group: "post" },
  { id: "reply", label: "Replied", category: "social", group: "post" },
  { id: "mention", label: "Mentioned you", category: "social", group: "post" },
  { id: "tag", label: "Tagged you", category: "social" },
  { id: "quote", label: "Quoted your post", category: "social", group: "post" },
  { id: "repost", label: "Reposted", category: "social", group: "post" },
  { id: "repost_engagement", label: "Engagement on your repost", category: "social", group: "post" },
  { id: "reshare", label: "Reshared your media", category: "social" },
  { id: "comment_reaction", label: "Reacted to your comment", category: "social", group: "post" },
  { id: "share", label: "Shared your post", category: "social", group: "post" },
  { id: "save", label: "Saved your post", category: "social", group: "post" },
  { id: "profile_view", label: "Viewed your profile", category: "social", group: "together" },
  { id: "invite", label: "Invited you", category: "social" },
  { id: "milestone", label: "Milestone reached", category: "social" },
  { id: "friend_request", label: "Friend request", category: "social" },
  { id: "friend_accepted", label: "Friend request accepted", category: "social" },
  { id: "friend_reminder", label: "Friend reminder", category: "social" },
  { id: "message", label: "New message", category: "social", group: "conversation", countsToBadge: false },
  { id: "message_reaction", label: "Reacted to your message", category: "social", group: "conversation", countsToBadge: false },
  { id: "message_mention", label: "Mentioned you in chat", category: "social", group: "conversation" },
  /* ── downloads ── */
  { id: "download_complete", label: "Download complete", category: "downloads" },
  { id: "download_failed", label: "Download failed", category: "downloads" },
  { id: "download_ready", label: "Download ready", category: "downloads" },
  { id: "processing_finished", label: "Processing finished", category: "downloads" },
  /* ── community ── */
  { id: "community_invite", label: "Community invite", category: "community" },
  { id: "community_accepted", label: "Community request accepted", category: "community" },
  { id: "community_announcement", label: "Community announcement", category: "community" },
  { id: "community_event", label: "Community event", category: "community" },
  /* ── news ── */
  { id: "news_breaking", label: "Breaking news", category: "news" },
  { id: "news_trending", label: "Trending now", category: "news" },
  { id: "news_following", label: "From who you follow", category: "news" },
  { id: "news_recommended", label: "Recommended for you", category: "news" },
  /* ── premium ── */
  { id: "subscription_activated", label: "Subscription activated", category: "premium" },
  { id: "payment_successful", label: "Payment successful", category: "premium" },
  { id: "renewal_reminder", label: "Renewal reminder", category: "premium" },
  { id: "premium_expiring", label: "Premium expiring", category: "premium" },
  /* ── security ── */
  { id: "security_login", label: "New sign-in", category: "security" },
  { id: "security_new_device", label: "New device", category: "security" },
  { id: "security_password", label: "Password changed", category: "security" },
  { id: "security_2fa", label: "Two-factor enabled", category: "security" },
  { id: "security_suspicious", label: "Suspicious activity", category: "security" },
  { id: "security_recovery", label: "Recovery updated", category: "security" },
  { id: "security_2fa_disabled", label: "Two-factor disabled", category: "security" },
  { id: "security_recovery_used", label: "Recovery code used", category: "security" },
  { id: "security_passkey_enrolled", label: "Passkey added", category: "security" },
  { id: "security_passkey_removed", label: "Passkey removed", category: "security" },
  /* ── system (categoryMutable:false ⇒ always shown regardless of category prefs) ── */
  { id: "system", label: "System", category: "system", categoryMutable: false },
  { id: "admin_broadcast", label: "Announcement", category: "system", categoryMutable: false },
  { id: "post_under_review", label: "Post under review", category: "system" },
  { id: "moderation_appeal_resolved", label: "Appeal resolved", category: "system" },
] as const satisfies readonly NotificationDef[];

/** The union of every declared notification type. */
export type NotificationType = (typeof NOTIFICATIONS)[number]["id"];

/* --------------------------------- derived --------------------------------- */

/**
 * Type → category, but ONLY for category-mutable types — this is the exact shape
 * `mutedTypesFor` consumes to build its exclusion list. `system`/`admin_broadcast`
 * are omitted so category muting can never hide them (the historical behaviour).
 */
// `as const` narrows each entry to its exact literal shape, so members that omit an
// optional field don't expose it on the union — read optionals through NotificationDef,
// where an absent one is simply `undefined`.
export const CATEGORY_BY_TYPE: Partial<Record<NotificationType, NotificationCategory>> =
  Object.fromEntries(
    NOTIFICATIONS.filter((n) => (n as NotificationDef).categoryMutable !== false).map((n) => [n.id, n.category]),
  );

/** A type's category (for display/grouping). Falls back to `system`. */
export function categoryForType(type: NotificationType): NotificationCategory {
  return NOTIFICATIONS.find((n) => n.id === type)?.category ?? "system";
}

/** All types with a given collapse rule (powers the grouped view's Sets). */
export function typesGroupedBy(group: NotificationGroupBy): NotificationType[] {
  return NOTIFICATIONS.filter((n) => (n as NotificationDef).group === group).map((n) => n.id);
}

/** Types excluded from the bell's numeric badge (they have their own badge). */
export function badgeExcludedTypes(): NotificationType[] {
  return NOTIFICATIONS.filter((n) => (n as NotificationDef).countsToBadge === false).map((n) => n.id);
}

/** All declared notifications, in declaration order. */
export function getNotifications(): readonly NotificationDef[] {
  return NOTIFICATIONS;
}

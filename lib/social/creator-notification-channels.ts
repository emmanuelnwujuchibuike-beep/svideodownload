/**
 * Per-creator notification CHANNELS — the pure, client-safe half.
 *
 * Owner, 2026-08-23: "make users to be able to turn on and off another users
 * post notification, stories notification, feed or share notification."
 *
 * 🔴 SEPARATE FILE ON PURPOSE. Its sibling `creator-notifications.ts` imports
 * `createAdminClient`, which is marked `server-only` — importing anything from
 * that module inside a Client Component makes the build fail with "This module
 * cannot be imported from a Client Component module", and the switches UI
 * (`creator-notifications-sheet.tsx`) needs exactly the constants below. Types
 * and plain data live here; anything that touches the database lives there and
 * re-exports these so server callers still have one import.
 */

export const CREATOR_NOTIFICATION_CHANNELS = ["posts", "stories", "feed", "shares"] as const;

export type CreatorNotificationChannel = (typeof CREATOR_NOTIFICATION_CHANNELS)[number];

export type CreatorNotificationPrefs = Record<CreatorNotificationChannel, boolean>;

/**
 * 🔴 THE SINGLE SOURCE OF TRUTH for what "no row" means.
 *
 * The table has matching column defaults, but a row is only written when
 * someone changes something — so most (viewer, target) pairs have no row at
 * all and are resolved here instead. If the two ever disagree, the same person
 * gets different behaviour depending on whether they once toggled an unrelated
 * switch, which is close to impossible to diagnose from a bug report.
 *
 * `posts`/`stories`/`feed` are opt-IN: notifying every follower about every
 * post from everyone they follow is how a notification bell becomes something
 * people permanently silence. False also means shipping this feature changed
 * nothing for anyone until they asked for it.
 *
 * `shares` defaults ON because that notification ALREADY fires (the `share`
 * type — "Shared your post"). Defaulting it off would have silently stopped a
 * notification people already receive: a behaviour change disguised as a
 * feature. What is new there is the ability to switch it off per person.
 */
export const DEFAULT_CREATOR_NOTIFICATION_PREFS: CreatorNotificationPrefs = {
  posts: false,
  stories: false,
  feed: false,
  shares: true,
};

/** Human labels + one line of "what will actually reach me", for the UI. */
export const CREATOR_NOTIFICATION_LABELS: Record<
  CreatorNotificationChannel,
  { label: string; hint: string }
> = {
  posts: { label: "Posts", hint: "When they publish something new." },
  stories: { label: "Stories", hint: "When they add to their story." },
  feed: { label: "Feed activity", hint: "When they repost or reshare." },
  shares: { label: "Shares", hint: "When they share your post." },
};

/** True when every channel matches its default — the row can then be deleted. */
export function isAllDefaultPrefs(prefs: CreatorNotificationPrefs): boolean {
  return CREATOR_NOTIFICATION_CHANNELS.every(
    (c) => prefs[c] === DEFAULT_CREATOR_NOTIFICATION_PREFS[c],
  );
}

import { CATEGORY_BY_TYPE, type NotificationCategory, type NotificationType } from "@/lib/platform/notifications-registry";
import { SITE_URL } from "@/lib/site";

/**
 * Where a notification GOES when it is tapped.
 *
 * Owner, 2026-08-26: "make all notification in notification page to open the
 * page to the notification, and security too, so when any security
 * notification come it can be clickable to open the exact page to see the full
 * details to know if is to make any security changes, same way for all
 * notification that is in notification page."
 *
 * ── What was wrong ─────────────────────────────────────────────────────────
 *
 * The card's own `hrefFor` handled four cases — a conversation, a post, a
 * friend request, and a single-actor follow — and returned NULL for everything
 * else. The card renders a plain `<div>` instead of a `<Link>` when the href is
 * null, so a security alert, a payment, a download outcome, a streak or a
 * moderation decision was literally not tappable. "Suspicious activity on your
 * account" was a dead end at the exact moment it most needs to lead somewhere.
 *
 * ── The three-step resolution ──────────────────────────────────────────────
 *
 * 1. The notification's OWN url, stored on `data.url` — the exact page the
 *    sender meant, e.g. the precise device in a new-device alert. Always wins,
 *    because it is the only source that knows the specific thing that happened.
 * 2. This per-type map — a real page for every declared type, so a type that
 *    never carries a url still lands somewhere useful and relevant.
 * 3. The category fallback, so a type added to the registry tomorrow without
 *    touching this file still resolves to a sensible page rather than to null.
 *
 * `notification-destinations.test.ts` asserts step 2 or 3 answers for EVERY type
 * in the registry, which is what makes "all notifications are clickable" a
 * property of the system rather than a claim about the types that exist today.
 */

/** Landing pages by category — the backstop, never null. */
const BY_CATEGORY: Record<NotificationCategory, string> = {
  // A social notification with no actor and no post is rare; the bell itself is
  // the honest destination rather than a profile that may not be the subject.
  social: "/notifications",
  downloads: "/downloads",
  community: "/friends",
  news: "/explore",
  premium: "/account/plan",
  // 🔴 The category the owner called out. Every security alert lands on the
  // page where the account can actually be changed — the whole point of being
  // told is being able to act on it.
  security: "/account/security",
  system: "/notifications",
};

/**
 * Per-type destinations, where the category page is not the most useful answer.
 * Only types that need something more specific appear here.
 */
const BY_TYPE: Partial<Record<NotificationType, string>> = {
  /* social */
  friend_request: "/friends",
  friend_accepted: "/friends",
  friend_reminder: "/friends",
  message: "/messages",
  message_reaction: "/messages",
  message_mention: "/messages",
  profile_view: "/account/analytics",
  milestone: "/account/analytics",
  invite: "/friends",

  /* security — the specific surface each alert is about, so the member lands on
     the control they would go looking for rather than a security index page. */
  security_login: "/account/devices",
  security_new_device: "/account/devices",
  security_password: "/account/password",
  security_recovery: "/account/security",
  security_recovery_used: "/account/security",
  security_2fa: "/account/security",
  security_2fa_disabled: "/account/security",
  security_passkey_enrolled: "/account/security",
  security_passkey_removed: "/account/security",
  security_suspicious: "/account/devices",

  /* premium */
  payment_successful: "/account/plan",
  subscription_activated: "/account/plan",
  renewal_reminder: "/account/plan",
  premium_expiring: "/account/plan",

  /* system */
  moderation_appeal_resolved: "/account/appeals",
  post_under_review: "/account/appeals",
  streak_reminder: "/home",
  streak_milestone: "/home",
  streak_lost: "/home",
};

/**
 * The default destination for a type, ignoring anything the notification itself
 * carries. Never null — see the module docstring.
 */
export function defaultHrefFor(type: NotificationType | string): string {
  const t = type as NotificationType;
  const explicit = BY_TYPE[t];
  if (explicit) return explicit;
  const category = CATEGORY_BY_TYPE[t];
  return (category && BY_CATEGORY[category]) || "/notifications";
}

/**
 * Only same-origin, absolute-path links are followed.
 *
 * `data.url` reaches this from a push payload, and several of those are built
 * from server config — so treating it as a trusted href would make any future
 * path that lets a value into a payload an open-redirect. A protocol-relative
 * `//evil.example` is rejected too: it looks like a path and is not one.
 */
export function safeInternalHref(url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  // A protocol-relative "//evil.example" looks like a path and is not one.
  if (url.startsWith("//")) return null;
  if (url.startsWith("/")) return url;
  /*
    Push payloads are built for the OS notification, which needs an ABSOLUTE
    url — every admin alert sends `${SITE_URL}/admin`. In the Notification
    Center that same link has to become a path, or Next routes it as an
    external navigation and reloads the whole app. Same-origin absolutes are
    reduced to their path; anything else is refused, so a value that ever
    reaches a payload from outside cannot turn this into an open redirect.
  */
  try {
    const parsed = new URL(url);
    const here = typeof window !== "undefined" ? window.location.origin : SITE_URL;
    if (parsed.origin !== new URL(here).origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/**
 * The final destination for one notification: its own url if it has a usable
 * one, otherwise the default for its type.
 */
export function hrefForNotification(type: NotificationType | string, url?: unknown): string {
  return safeInternalHref(url) ?? defaultHrefFor(type);
}

/**
 * API Registry — the declared manifest of the public HTTP API (`/api/v1`).
 *
 * The brief's "API Registry™". Every versioned endpoint is one row here: method,
 * path, auth model, category and a one-line description. It is a CATALOGUE (the
 * route files remain the behaviour), kept from drifting by `api-registry.test.ts`,
 * which asserts every declared endpoint maps to a route file that actually exports
 * that method. So a renamed/removed route, or a method that moved, fails the suite.
 *
 * Auth models, deliberately distinct:
 *   - `api-key`  — the developer API (`Authorization: Bearer <key>`, `lib/api/auth`).
 *   - `session`  — the app's own backend (cookie on web, bearer token on native;
 *                  `lib/api/authenticate`). One backend, four clients (see the SDK).
 *   - `session-optional` — answers signed-out visitors too, with less (Frenz Exclusive:
 *                  the locked gallery shows covers and counts, never content).
 *   - `admin`    — an administrator session, re-checked from the database per request
 *                  (`lib/admin/require-admin`). Anyone else gets 404 or 403.
 *
 * Since Frenz Exclusive Part 2 (2026-10-16) the subscription routes (`/api/sub/*`) are
 * catalogued here too (AGENTS.md: "An API route → declare it in api-registry.ts"). A row
 * describes the route; it never grants or removes access — the route file does that.
 */

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ApiAuth = "api-key" | "session" | "session-optional" | "admin";
export type ApiCategory =
  | "download"
  | "usage"
  | "account"
  | "feed"
  | "devices"
  | "sessions"
  | "security"
  | "subscriptions"
  | "messaging"
  | "payments";

export interface ApiEndpoint {
  method: ApiMethod;
  /** Route path under the app, e.g. "/api/v1/analyze". `[id]` denotes a param. */
  path: string;
  auth: ApiAuth;
  category: ApiCategory;
  description: string;
}

export const API_ENDPOINTS: ApiEndpoint[] = [
  /* ── developer API (API key) ── */
  { method: "POST", path: "/api/v1/analyze", auth: "api-key", category: "download", description: "Media metadata for a URL (no direct links)." },
  { method: "POST", path: "/api/v1/download", auth: "api-key", category: "download", description: "Resolve a downloadable link for a URL." },
  { method: "GET", path: "/api/v1/usage", auth: "api-key", category: "usage", description: "Your API usage and remaining quota." },

  /* ── app API (session) ── */
  { method: "GET", path: "/api/v1/app/me", auth: "session", category: "account", description: "Signed-in identity + entitlements (logged-out shell for anon)." },
  { method: "GET", path: "/api/v1/app/feed", auth: "session", category: "feed", description: "A page of the user's home feed." },

  { method: "GET", path: "/api/v1/app/sessions", auth: "session", category: "sessions", description: "List active sessions." },
  { method: "DELETE", path: "/api/v1/app/sessions", auth: "session", category: "sessions", description: "Revoke all other sessions." },
  { method: "DELETE", path: "/api/v1/app/sessions/[id]", auth: "session", category: "sessions", description: "Revoke one session." },

  { method: "PATCH", path: "/api/v1/app/devices/[id]", auth: "session", category: "devices", description: "Rename or trust a device." },
  { method: "DELETE", path: "/api/v1/app/devices/[id]", auth: "session", category: "devices", description: "Remove a device." },

  { method: "GET", path: "/api/v1/app/security/settings", auth: "session", category: "security", description: "Read account security settings." },
  { method: "PATCH", path: "/api/v1/app/security/settings", auth: "session", category: "security", description: "Update account security settings." },
  { method: "GET", path: "/api/v1/app/security/audit-log", auth: "session", category: "security", description: "The account's security audit log." },
  { method: "POST", path: "/api/v1/app/security/password", auth: "session", category: "security", description: "Set or change the password; a session that signed in with a password must include the emailed code." },
  { method: "POST", path: "/api/v1/app/security/password/code", auth: "session", category: "security", description: "Email the member a 6-digit code (10 minutes) for changing their password." },
  { method: "POST", path: "/api/v1/app/security/password-changed", auth: "session", category: "security", description: "Record a password change." },
  { method: "POST", path: "/api/v1/app/security/mfa-event", auth: "session", category: "security", description: "Record an MFA enrolment/removal event." },
  { method: "POST", path: "/api/v1/app/security/mfa/unenroll", auth: "session", category: "security", description: "Disable multi-factor auth." },
  { method: "GET", path: "/api/v1/app/security/pin/status", auth: "session", category: "security", description: "Whether a security PIN is set." },
  { method: "POST", path: "/api/v1/app/security/pin", auth: "session", category: "security", description: "Set or change the security PIN." },
  { method: "POST", path: "/api/v1/app/security/pin/verify", auth: "session", category: "security", description: "Verify the PIN (step-up)." },
  { method: "GET", path: "/api/v1/app/security/recovery-codes", auth: "session", category: "security", description: "Recovery-code status." },
  { method: "POST", path: "/api/v1/app/security/recovery-codes/generate", auth: "session", category: "security", description: "Generate a fresh set of recovery codes." },
  { method: "POST", path: "/api/v1/app/security/recovery-codes/redeem", auth: "session", category: "security", description: "Redeem a recovery code." },
  { method: "GET", path: "/api/v1/app/security/passkeys", auth: "session", category: "security", description: "List registered passkeys." },
  { method: "PATCH", path: "/api/v1/app/security/passkeys/[id]", auth: "session", category: "security", description: "Rename a passkey." },
  { method: "DELETE", path: "/api/v1/app/security/passkeys/[id]", auth: "session", category: "security", description: "Remove a passkey." },
  { method: "POST", path: "/api/v1/app/security/passkeys/register/options", auth: "session", category: "security", description: "Begin passkey registration (WebAuthn options)." },
  { method: "POST", path: "/api/v1/app/security/passkeys/register/verify", auth: "session", category: "security", description: "Complete passkey registration." },
  { method: "POST", path: "/api/v1/app/security/passkeys/stepup/options", auth: "session", category: "security", description: "Begin a passkey step-up challenge." },
  { method: "POST", path: "/api/v1/app/security/passkeys/stepup/verify", auth: "session", category: "security", description: "Complete a passkey step-up challenge." },

  /* ── Messaging ── */
  { method: "POST", path: "/api/messages/[id]/typing", auth: "session", category: "messaging", description: "\"… is typing\" push for a direct chat whose other member's app is closed: at most once per 5 minutes per sender, blocks/mute/Ghost Mode re-checked." },
  { method: "GET", path: "/api/conversations/[id]/media", auth: "session", category: "messaging", description: "A chat's Media, links & files (?tab=media|links|files&before=): active members only, newest first, deleted messages excluded, never a Secret Chat's links." },

  /* ── Frenz Exclusive / SUB (session; money and access are decided on the server) ── */
  { method: "GET", path: "/api/sub/feed", auth: "session", category: "subscriptions", description: "The Exclusive feed: posts from creators the viewer subscribes to (keyset-paged) and locked previews to discover." },
  { method: "POST", path: "/api/sub/feed/previews", auth: "session", category: "subscriptions", description: "Fresh five-minute preview links for feed tiles whose links expired; access re-checked, unseen posts left out." },
  { method: "POST", path: "/api/sub/checkout", auth: "session", category: "subscriptions", description: "Open (or reuse) a Paystack checkout for a creator subscription. Price and fee are the server's." },
  { method: "GET", path: "/api/sub/earnings", auth: "session", category: "subscriptions", description: "The signed-in creator's SUB balance, ledger and withdrawals." },
  { method: "GET", path: "/api/sub/notify", auth: "session-optional", category: "subscriptions", description: "How the viewer hears about a creator's new exclusive posts (off for signed-out)." },
  { method: "PUT", path: "/api/sub/notify", auth: "session", category: "subscriptions", description: "Set push / email / both / off for one creator's new exclusive posts." },
  { method: "GET", path: "/api/sub/payout-account", auth: "session", category: "subscriptions", description: "The creator's saved payout bank (masked)." },
  { method: "POST", path: "/api/sub/payout-account", auth: "session", category: "subscriptions", description: "Save or change the payout bank (Paystack names the holder) and the auto-withdraw switch." },
  { method: "DELETE", path: "/api/sub/payout-account", auth: "session", category: "subscriptions", description: "Remove the saved payout bank." },
  { method: "POST", path: "/api/sub/withdraw", auth: "session", category: "subscriptions", description: "Withdraw SUB earnings (minimum, fee and one-open rule enforced in SQL)." },
  { method: "GET", path: "/api/sub/subscriptions", auth: "session", category: "subscriptions", description: "The member's own paid subscriptions: state, access until, and renew / cancel / resume." },
  { method: "POST", path: "/api/sub/subscriptions", auth: "session", category: "subscriptions", description: "Cancel at the end of the paid period, or take that back. Never changes access or money." },
  { method: "GET", path: "/api/sub/transactions", auth: "session", category: "subscriptions", description: "The member's own subscription payments, keyset-paged, with the server's statuses." },
  { method: "GET", path: "/api/sub/earnings/overview", auth: "session", category: "subscriptions", description: "The creator's own balances (sub_balances) and 7/30/90-day analytics aggregated in the database (0252)." },
  { method: "GET", path: "/api/sub/earnings/ledger", auth: "session", category: "subscriptions", description: "The creator's own ledger, keyset-paged, filtered by type and UTC date range." },
  { method: "GET", path: "/api/admin/memberships/summary", auth: "admin", category: "subscriptions", description: "Exclusive subscription overview for a 7/30/90-day period (database aggregates; currencies kept apart)." },
  { method: "GET", path: "/api/admin/memberships/search", auth: "admin", category: "subscriptions", description: "Bounded search of subscription purchases by creator, subscriber, reference part, status and date." },
  { method: "GET", path: "/api/admin/memberships/reviews", auth: "admin", category: "subscriptions", description: "Exclusive money reviews: refunds not applied automatically (partial or other currency) and disputed purchases." },
  { method: "POST", path: "/api/admin/memberships/reviews", auth: "admin", category: "subscriptions", description: "Mark a refund review as looked at (no money moves), or restore a dispute the platform won (0254, once)." },
  { method: "GET", path: "/api/admin/memberships/moderation", auth: "admin", category: "subscriptions", description: "Exclusive moderation by state (open, removed, restored, dismissed), paged." },
  { method: "GET", path: "/api/sub/favourites", auth: "session", category: "subscriptions", description: "The member's own favourite creators (a favourite_creators circle), paged; public profile facts only." },
  { method: "POST", path: "/api/sub/favourites", auth: "session", category: "subscriptions", description: "Add or remove a favourite creator (idempotent). Grants no access; never touches a subscription." },
  { method: "GET", path: "/api/sub/announcements", auth: "session-optional", category: "subscriptions", description: "A creator's subscriber announcements: the creator, or an active subscriber right now; anyone else gets access:false." },
  { method: "POST", path: "/api/sub/announcements", auth: "session", category: "subscriptions", description: "Publish to YOUR subscribers (idempotency key). Fan-out is queued in bounded pages." },
  { method: "DELETE", path: "/api/sub/announcements", auth: "session", category: "subscriptions", description: "Delete one of your announcements (kept for audit, fan-out stopped)." },
  // Part 11 (0253): optional-email unsubscribe. No session — the unguessable token in the link is the authority, and it can only switch optional email OFF.
  { method: "POST", path: "/api/admin/auth/password-code", auth: "admin", category: "account", description: "Email the signed-in admin a 6-digit code (10 minutes) for changing their password from the dashboard; counts on the login throttle." },
  { method: "POST", path: "/api/admin/auth/password-code/verify", auth: "admin", category: "account", description: "Check the emailed code and set the new admin password; signs out other sessions and counts as re-authenticated." },
  { method: "DELETE", path: "/api/admin/users/age", auth: "admin", category: "account", description: "Clear a member's age answer so they answer again (audited). An admin can never set one." },
  { method: "GET", path: "/api/age", auth: "session-optional", category: "account", description: "The member age check: adult, minor (with the day they may answer again) or none. Never the date of birth." },
  { method: "POST", path: "/api/age", auth: "session", category: "account", description: "Answer the age check (date of birth + 18+ confirmation). The server decides and keeps only the outcome." },
  { method: "GET", path: "/api/email/unsubscribe", auth: "session-optional", category: "account", description: "Opens the unsubscribe confirmation. Changes nothing (link scanners open links)." },
  { method: "POST", path: "/api/email/unsubscribe", auth: "session-optional", category: "account", description: "Turn optional email off for the token's member: the page's button, or a mail client's RFC 8058 one-click. Idempotent." },
  { method: "GET", path: "/api/members/subscribers", auth: "session", category: "subscriptions", description: "The signed-in creator's own paid subscribers, paged. No amounts or payment details." },
  { method: "GET", path: "/api/sub/posts", auth: "session-optional", category: "subscriptions", description: "A creator's exclusive gallery: covers and counts for everyone, content only with access." },
  { method: "POST", path: "/api/sub/posts", auth: "session", category: "subscriptions", description: "Publish an exclusive post from files in the creator's own private folder." },
  { method: "POST", path: "/api/sub/posts/upload", auth: "session", category: "subscriptions", description: "A five-minute upload link into the creator's own private-bucket folder." },
  { method: "GET", path: "/api/sub/posts/[id]", auth: "session", category: "subscriptions", description: "Open one exclusive post: access re-checked, then five-minute media links." },
  { method: "PATCH", path: "/api/sub/posts/[id]", auth: "session", category: "subscriptions", description: "The creator edits their own post: a missing preview, the caption, who sees it exists, or Mature (18+)." },
  { method: "DELETE", path: "/api/sub/posts/[id]", auth: "session", category: "subscriptions", description: "The creator deletes their own post and its private files (not while taken down)." },
  { method: "GET", path: "/api/sub/posts/[id]/like", auth: "session", category: "subscriptions", description: "Likes, comment count and whether I liked it (subscribers and the creator)." },
  { method: "POST", path: "/api/sub/posts/[id]/like", auth: "session", category: "subscriptions", description: "Like or unlike an exclusive post (subscribers and the creator)." },
  { method: "GET", path: "/api/sub/posts/[id]/comments", auth: "session", category: "subscriptions", description: "Comments on an exclusive post (subscribers and the creator)." },
  { method: "POST", path: "/api/sub/posts/[id]/comments", auth: "session", category: "subscriptions", description: "Comment on an exclusive post (subscribers and the creator)." },
  { method: "DELETE", path: "/api/sub/posts/[id]/comments", auth: "session", category: "subscriptions", description: "Delete your own comment, or any comment on your own post." },
  { method: "POST", path: "/api/sub/posts/[id]/capture", auth: "session", category: "subscriptions", description: "Report a screenshot shortcut seen while an exclusive post was open." },
  { method: "GET", path: "/api/admin/moderation/sub-review", auth: "admin", category: "subscriptions", description: "Admin review of a reported exclusive post or comment: five-minute links, audited." },
  { method: "POST", path: "/api/verification/paid", auth: "session", category: "account", description: "0268: open (or reuse) a Paystack checkout for the blue tick at the admin's price." },
  { method: "POST", path: "/api/verification/paid/confirm", auth: "session", category: "account", description: "0268: settle the member's own verification checkout from Paystack's verified charge (the return page)." },
  { method: "GET", path: "/api/admin/verification/paid-settings", auth: "admin", category: "account", description: "0268: the paid-verification switch, price and period." },
  { method: "POST", path: "/api/admin/verification/paid-settings", auth: "admin", category: "account", description: "0268: save the paid-verification switch, price and period (clamped)." },
  { method: "POST", path: "/api/admin/ratings/ban", auth: "admin", category: "security", description: "0267: ban the person behind an app rating — account (suspended, audited) and every device identifier the rating carried; the fetch route then refuses them." },
  { method: "DELETE", path: "/api/admin/ratings/ban", auth: "admin", category: "security", description: "0267: lift a rating ban (and the account suspension it made)." },
  // Flutterwave admin controls (Parts 2, 3.3, 5)
  { method: "GET", path: "/api/admin/flutterwave", auth: "admin", category: "payments", description: "Flutterwave settings: masks and sources of the key and hash (never the secrets), the capability gate per purpose, plan ids, the webhook URL." },
  { method: "POST", path: "/api/admin/flutterwave", auth: "admin", category: "payments", description: "Save Flutterwave settings to the private 0272 table (fresh password). Secrets are write-only." },
  { method: "GET", path: "/api/admin/flutterwave/reviews", auth: "admin", category: "payments", description: "Plan billing waiting for a person (0274 plan_billing_reviews)." },
  { method: "POST", path: "/api/admin/flutterwave/reviews", auth: "admin", category: "payments", description: "Apply a proven renewal once, or resolve / dismiss a review (fresh password)." },
  { method: "POST", path: "/api/admin/flutterwave/test", auth: "admin", category: "payments", description: "Part 5: test the saved Flutterwave key with one read-only call — a fixed code and copy, never the key or provider text. Audited." },
  { method: "GET", path: "/api/admin/flutterwave/transactions", auth: "admin", category: "payments", description: "Part 5: payment attempts across the existing ledgers plus the webhook log, filtered by provider / purpose / reconciliation state / reference." },
  { method: "POST", path: "/api/admin/flutterwave/transactions", auth: "admin", category: "payments", description: "Part 5: recheck ONE attempt by reference through its purpose's existing idempotent settle path (fresh password, rate limited, audited)." },
];

export function getApiEndpoints(): ApiEndpoint[] {
  return API_ENDPOINTS;
}

/** The route file that should back an endpoint path (relative to repo root). */
export function routeFileFor(path: string): string {
  return `app${path}/route.ts`;
}

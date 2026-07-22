/**
 * API Registry — the declared manifest of the public HTTP API (`/api/v1`).
 *
 * The brief's "API Registry™". Every versioned endpoint is one row here: method,
 * path, auth model, category and a one-line description. It is a CATALOGUE (the
 * route files remain the behaviour), kept from drifting by `api-registry.test.ts`,
 * which asserts every declared endpoint maps to a route file that actually exports
 * that method. So a renamed/removed route, or a method that moved, fails the suite.
 *
 * Two auth models, deliberately distinct:
 *   - `api-key`  — the developer API (`Authorization: Bearer <key>`, `lib/api/auth`).
 *   - `session`  — the app's own backend (cookie on web, bearer token on native;
 *                  `lib/api/authenticate`). One backend, four clients (see the SDK).
 */

export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type ApiAuth = "api-key" | "session";
export type ApiCategory =
  | "download"
  | "usage"
  | "account"
  | "feed"
  | "devices"
  | "sessions"
  | "security";

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
];

export function getApiEndpoints(): ApiEndpoint[] {
  return API_ENDPOINTS;
}

/** The route file that should back an endpoint path (relative to repo root). */
export function routeFileFor(path: string): string {
  return `app${path}/route.ts`;
}

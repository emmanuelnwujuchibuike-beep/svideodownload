/**
 * Profile OS™ — the service map (Feature 18 · Part 20).
 *
 * ── What this is, and what it deliberately is not ─────────────────────────
 * The brief asks for an operating system coordinating every profile
 * capability through micro-services and an event bus. Frenz is a modular
 * monolith on Postgres, and it should stay one: the profile's services are
 * already separate modules with clear owners, and splitting them into network
 * services would add latency, partial failure and deployment surface to a
 * product whose hardest constraint is a two-second page load.
 *
 * So Profile OS is not a runtime layer. It is the MAP — the thing that was
 * genuinely missing. Twenty parts of profile work produced ~30 modules, a
 * dozen tables and several registries, and nothing named them in one place.
 * That is a real cost: it is how the same capability gets built twice, how
 * Layout Studio ended up writing variables only its own preview read, and how
 * a "declared but not built" module survives three parts unnoticed.
 *
 * ── Why a catalogue beats an abstraction here ────────────────────────────
 * A coordinating runtime that every service must call through is a single
 * point of failure and an indirection between a page and its data. A
 * catalogue costs nothing at runtime, is checked by tests, and answers the
 * questions people actually have: what owns this, where does it live, is it
 * real yet. `os.test.ts` asserts every service points at a module that exists
 * and a table this platform catalogues, so the map cannot quietly go stale.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type ServiceStatus =
  /** Built, wired and reachable by a member today. */
  | "live"
  /** The data layer exists; no surface reads it yet. */
  | "backend-only"
  /** Named by a brief, deliberately not built. The reason is recorded. */
  | "declined";

export interface ProfileService {
  key: string;
  name: string;
  /** What it does, in one line. */
  blurb: string;
  /** The module that owns its rules. */
  owner: string;
  /** Tables it reads or writes. Empty when it is pure logic. */
  tables: readonly string[];
  status: ServiceStatus;
  /** For `declined`: why, specifically. Never "out of scope". */
  reason?: string;
  /** Which Feature 18 part introduced it. */
  part: number;
}

export const PROFILE_SERVICES: readonly ProfileService[] = [
  {
    key: "identity",
    name: "Identity",
    blurb: "The one profile row: name, handle, avatar, cover, verification.",
    owner: "lib/social/profile",
    tables: ["profiles"],
    status: "live",
    part: 1,
  },
  {
    key: "engine",
    name: "Profile Engine",
    blurb: "Decides which sections a profile shows, in what order, to whom.",
    owner: "lib/profile/engine",
    tables: ["profile_modules"],
    status: "live",
    part: 14,
  },
  {
    key: "audience",
    name: "Audience",
    blurb: "Derives the viewer's role and what it entitles them to see.",
    owner: "lib/profile/audience",
    tables: [],
    status: "live",
    part: 14,
  },
  {
    key: "details",
    name: "Profile Details",
    blurb: "Headline, category, skills, hours, contact and the showcase.",
    owner: "lib/social/profile-platform",
    tables: ["profile_details", "profile_credentials", "profile_offerings"],
    status: "live",
    part: 14,
  },
  {
    key: "health",
    name: "Profile Health",
    blurb: "Six weighted pillars and the one thing worth doing next.",
    owner: "lib/profile/health",
    tables: [],
    status: "live",
    part: 15,
  },
  {
    key: "growth",
    name: "Growth",
    blurb: "Trends over stored snapshots. Returns null rather than a flat line.",
    owner: "lib/profile/growth",
    tables: ["profile_snapshots"],
    status: "backend-only",
    part: 15,
  },
  {
    key: "theme",
    name: "Layout Studio",
    blurb: "Theme, surface, corner radius and text scale, with contrast correction.",
    owner: "lib/profile/theme",
    tables: ["profile_appearance"],
    status: "live",
    part: 16,
  },
  {
    key: "widgets",
    name: "Widgets",
    blurb: "The small blocks a member can place on their profile.",
    owner: "lib/profile/widgets",
    tables: ["profile_widgets"],
    status: "backend-only",
    part: 16,
  },
  {
    key: "graph",
    name: "Social Graph",
    blurb: "Private labels and circles over the follow/friend edges that already exist.",
    owner: "lib/social/graph",
    tables: ["relationship_labels", "social_circles", "circle_members"],
    status: "live",
    part: 17,
  },
  {
    key: "discovery",
    name: "Discovery",
    blurb: "Who can be found, by what, with location off by default.",
    owner: "lib/discovery",
    tables: ["profile_discovery"],
    status: "live",
    part: 18,
  },
  {
    key: "card",
    name: "Digital Card",
    blurb: "The shareable card and its locally generated QR code.",
    owner: "lib/qr, lib/profile/vcard",
    tables: [],
    status: "live",
    part: 18,
  },
  {
    key: "privacy",
    name: "Privacy",
    blurb: "Who can see you, stated in plain language and derived from the real columns.",
    owner: "lib/privacy",
    tables: ["privacy_settings"],
    status: "live",
    part: 19,
  },
  {
    key: "security",
    name: "Security",
    blurb: "One score over MFA, passkeys, recovery codes, PIN and devices.",
    owner: "lib/security/score",
    tables: ["account_security_settings", "webauthn_credentials", "trusted_devices"],
    status: "live",
    part: 19,
  },
  {
    key: "versions",
    name: "Version History",
    blurb: "Every layout change, restorable — the undo the profile never had.",
    owner: "lib/profile/versions",
    tables: ["profile_versions"],
    status: "live",
    part: 20,
  },

  // ── Named by the briefs, deliberately not built ────────────────────────
  {
    key: "plugins",
    name: "Plugin Framework",
    blurb: "Third-party modules installed into a profile.",
    owner: "—",
    tables: [],
    status: "declined",
    reason:
      "Running third-party code inside a member's profile needs a real sandbox, a permission model, a review process and a revocation path. Half-built, it is arbitrary code with access to an identity — the single largest security surface any of these briefs has proposed, and not something to ship because a roadmap named it.",
    part: 20,
  },
  {
    key: "microservices",
    name: "Micro-service split",
    blurb: "Each capability as its own network service.",
    owner: "—",
    tables: [],
    status: "declined",
    reason:
      "Frenz is a modular monolith on Postgres and should stay one. Splitting these modules over the network adds latency, partial failure and deploy surface to a product whose hardest constraint is a two-second cold load. The module boundaries are already real; the network hop is the part that would only cost.",
    part: 20,
  },
  {
    key: "screenshot-alerts",
    name: "Screenshot alerts",
    blurb: "Tell a member when someone screenshots their content.",
    owner: "—",
    tables: [],
    status: "declined",
    reason:
      "The web platform exposes no screenshot signal. Claiming it would make people share things they would otherwise keep private, on a promise nothing can keep.",
    part: 19,
  },
  {
    key: "guardian",
    name: "Guardian accounts",
    blurb: "An adult supervising another account.",
    owner: "—",
    tables: [],
    status: "declined",
    reason:
      "Account linking with delegated control — the same class as trusted-contact recovery. It needs consent, scoped permissions, revocation and an audit trail before it can exist at all, and the threat model has to assume the supervisor is the risk.",
    part: 19,
  },
] as const;

const BY_KEY = new Map(PROFILE_SERVICES.map((s) => [s.key, s]));

export function profileService(key: string): ProfileService | undefined {
  return BY_KEY.get(key);
}

export function servicesByStatus(status: ServiceStatus): ProfileService[] {
  return PROFILE_SERVICES.filter((s) => s.status === status);
}

/** Everything a member can actually use today. */
export function liveServices(): ProfileService[] {
  return servicesByStatus("live");
}

/** Built but unreachable — the backlog that matters most, because it is nearly done. */
export function backendOnlyServices(): ProfileService[] {
  return servicesByStatus("backend-only");
}

/** Every table the profile platform touches, deduped. */
export function profileTables(): string[] {
  return [...new Set(PROFILE_SERVICES.flatMap((s) => s.tables))].sort();
}

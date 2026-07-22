/**
 * The Registry of Registries — the Platform Kernel describing itself.
 *
 * The brief's "System Registries" section names ~14 registries. This is that list,
 * made real and HONEST: each entry points at the actual source-of-truth file that
 * governs it, with a status that does not overstate. It is deliberately a catalogue
 * of what EXISTS, not a set of new abstractions — several of these registries were
 * already the single source for their domain long before this file; a few are
 * genuinely new (flags, experiments, events); and where a "registry" is really a
 * convention rather than a declared list, it says so (`partial`).
 *
 * This is subject to the same truth rule as everything else (docs/CONSTITUTION.md,
 * Article I.3): a `live` entry must point at a file that exists. `platform-catalog.test.ts`
 * asserts it, so this catalogue cannot drift into describing files that aren't there.
 */

export type RegistryStatus =
  /** A declared, single-source-of-truth list in code. */
  | "live"
  /** Real and load-bearing, but a convention/scattered source rather than one list. */
  | "partial"
  /** Named in the brief, not built. Honest placeholder, never implied as done. */
  | "planned";

export interface RegistryDef {
  id: string;
  /** The brief's name for it. */
  name: string;
  /** One line: what it governs. */
  governs: string;
  /** Repo-relative source-of-truth path. Empty only when `planned`. */
  source: string;
  status: RegistryStatus;
  note?: string;
}

export const REGISTRIES: RegistryDef[] = [
  { id: "product", name: "Product / Workspace / Feature Registry", governs: "Every product module — nav, RBAC, launcher, search all derive from it.", source: "lib/platform/modules.ts", status: "live" },
  { id: "navigation", name: "Navigation Registry", governs: "Destinations, commands and workspaces for the command centre and nav.", source: "lib/navigation/registry.ts", status: "live" },
  { id: "feature-flags", name: "Feature-Flag Registry", governs: "Runtime toggles: kill switches, % rollouts, plan gates.", source: "lib/platform/flags.ts", status: "live" },
  { id: "experiments", name: "Experiment Registry", governs: "A/B tests: variants, weights, deterministic assignment.", source: "lib/platform/experiments.ts", status: "live" },
  { id: "events", name: "Event Registry", governs: "Every analytics event type and its metadata contract.", source: "lib/platform/events-registry.ts", status: "live" },
  { id: "content", name: "Knowledge / Content Registry", governs: "The content genome — approved content compiled to static TS.", source: "lib/content/genome/registry.ts", status: "live" },
  { id: "admin", name: "Admin Section Registry", governs: "The admin dashboard's information architecture.", source: "lib/admin/sections.ts", status: "live" },
  { id: "localization", name: "Localization Registry", governs: "Locales and the translation catalogue; coverage is measured.", source: "lib/i18n/locales.ts", status: "live" },
  { id: "search", name: "Search Registry", governs: "The cross-surface search index.", source: "lib/search/index.ts", status: "live" },
  { id: "design-tokens", name: "Design Token Registry", governs: "Colours, radius and motion — one typed token set; the CSS is generated from it.", source: "lib/platform/design-tokens.ts", status: "live", note: "Single source; globals.css custom properties are generated (npm run tokens:generate) and kept in sync by a test." },
  { id: "permissions", name: "Permission Registry", governs: "The access model: capabilities + the predicates that gate modules/nav.", source: "lib/platform/permissions.ts", status: "live", note: "Code-side authz (plan tiers + admin). Per-row RLS is a separate, deliberate layer in the migrations." },
  { id: "notifications", name: "Notification Registry", governs: "Every notification type, its category, grouping and badge rule.", source: "lib/platform/notifications-registry.ts", status: "live" },
  { id: "api", name: "API Registry", governs: "Every public /api/v1 endpoint: method, path, auth, category.", source: "lib/platform/api-registry.ts", status: "live", note: "Declared manifest, enforced against the real route files. The SDK (lib/sdk) is the typed client over it." },
  { id: "ai-capability", name: "AI Capability Registry", governs: "What the assistant can do, and its true status.", source: "lib/platform/ai-capabilities.ts", status: "live" },
  { id: "domain-events", name: "Domain Event Registry", governs: "Business event contracts (UserCreated, MessageSent, …) + typed payloads.", source: "lib/platform/domain-events.ts", status: "live", note: "Distinct from the analytics Event Registry; the event bus is typed against it." },
  { id: "integration", name: "Integration Registry", governs: "Every communication surface: APIs, events, realtime, webhooks, workflows.", source: "lib/platform/integration-registry.ts", status: "live" },
  { id: "data-domains", name: "Data Domain Registry", governs: "Every table, grouped by owning domain + storage strategy.", source: "lib/platform/data-domains.ts", status: "live", note: "Enforced against the migrations — every real table is owned by exactly one domain, no orphans." },
  { id: "knowledge-fabric", name: "Knowledge Fabric", governs: "The governed entity-relationship graph + storage/lifecycle policies over the data domains.", source: "lib/platform/data-platform.ts", status: "live" },
  { id: "test-types", name: "Test-Type Registry", governs: "Every kind of automated test the platform runs, and the ones decided-but-planned.", source: "lib/platform/test-types.ts", status: "live" },
  { id: "certifications", name: "Certification Engine", governs: "Production-readiness certifications, computed from the governance gates.", source: "lib/platform/certification.ts", status: "live" },
  { id: "infra-decisions", name: "Infrastructure Decisions", governs: "The chosen technology for each planned capability (ADRs as data).", source: "lib/platform/infra-decisions.ts", status: "live" },
];

export function getRegistries(): RegistryDef[] {
  return REGISTRIES;
}

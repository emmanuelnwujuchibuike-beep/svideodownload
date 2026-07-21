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
  { id: "design-tokens", name: "Design Token Registry", governs: "Colours, spacing, type — one token set for the whole app.", source: "tailwind.config.ts", status: "partial", note: "Tokens live in the Tailwind config (guarded by lib/design-tokens.test.ts), not a bespoke registry." },
  { id: "permissions", name: "Permission Registry", governs: "Access predicates at the module boundary + per-row RLS.", source: "lib/platform/module-registry.ts", status: "partial", note: "Predicates (everyone/proOnly/businessOnly/adminOnly) + RLS policies, not one central list." },
  { id: "notifications", name: "Notification Registry", governs: "Every notification type, its category, grouping and badge rule.", source: "lib/platform/notifications-registry.ts", status: "live" },
  { id: "api", name: "API Registry", governs: "The public developer API surface.", source: "lib/sdk/index.ts", status: "partial", note: "SDK types + app/api/v1 routes; not a single machine-readable manifest yet." },
  { id: "ai-capability", name: "AI Capability Registry", governs: "The assistant's knowledge and capabilities.", source: "lib/assistant/knowledge.ts", status: "partial", note: "Knowledge base exists; a formal capability manifest does not." },
];

export function getRegistries(): RegistryDef[] {
  return REGISTRIES;
}

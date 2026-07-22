/**
 * Engineering Registry — the Developer Experience Platform's catalogue of every
 * engineering ASSET: the docs, generators, SDKs, standards and registries a
 * contributor (human or AI) reaches for.
 *
 * The DX brief's "Engineering Registry™" / "Developer Knowledge Hub™": one map of
 * where the knowledge lives, who owns it, and whether it is real. It is a
 * catalogue over what EXISTS — this repo already has the docs, the codegen
 * scripts, the SDK and the registry-of-registries — kept honest by
 * `engineering.test.ts`: a `live` asset must point at a file that exists, and the
 * DX capabilities the brief names that we don't run yet (scaffold generators,
 * automated release notes, doc-usage analytics) are `planned`, not fabricated.
 */

export type EngineeringAssetKind =
  | "doc" // a docs/*.md reference
  | "guide" // onboarding for humans + AI assistants
  | "generator" // a code/asset generator script (Engineering Toolkit)
  | "sdk" // the cross-platform client
  | "standards" // the engineering standards, as data
  | "registry" // a single-source-of-truth registry (Architecture Navigator)
  | "template"; // a scaffold

export type EngineeringAssetStatus = "live" | "planned";

export interface EngineeringAsset {
  id: string;
  name: string;
  kind: EngineeringAssetKind;
  /** Repo-relative source. Empty only when `planned`. */
  source: string;
  /** The module/team that owns it. */
  owner: string;
  description: string;
  status: EngineeringAssetStatus;
  /** For a generator: the npm script that runs it. */
  command?: string;
  note?: string;
}

export const ENGINEERING_ASSETS: EngineeringAsset[] = [
  /* ── Knowledge Hub: the governing docs ── */
  { id: "architecture", name: "Architecture", kind: "doc", source: "docs/ARCHITECTURE.md", owner: "platform", description: "The modular-monolith shape: layers, features, boundaries.", status: "live" },
  { id: "constitution", name: "Engineering Constitution", kind: "doc", source: "docs/CONSTITUTION.md", owner: "platform", description: "The invariants + the honest Gap Ledger every change is held to.", status: "live" },
  { id: "security", name: "Security", kind: "doc", source: "docs/SECURITY.md", owner: "security", description: "Auth, RLS, fail-open rules and the incident record behind them.", status: "live" },
  { id: "performance", name: "Performance", kind: "doc", source: "docs/PERFORMANCE.md", owner: "platform", description: "The 2-second budget and how it's measured and enforced.", status: "live" },
  { id: "api", name: "API & SDK", kind: "doc", source: "docs/API.md", owner: "platform", description: "The public /api/v1 surface and how the SDK ships over it.", status: "live" },
  { id: "infrastructure", name: "Infrastructure", kind: "doc", source: "docs/INFRASTRUCTURE.md", owner: "devops", description: "Hosting, CDN, storage and the runtime topology.", status: "live" },
  { id: "design-system-doc", name: "Design System", kind: "doc", source: "docs/DESIGN_SYSTEM.md", owner: "design", description: "Tokens, components, motion, a11y and theming.", status: "live" },
  { id: "developer-experience", name: "Developer Experience", kind: "doc", source: "docs/DEVELOPER_EXPERIENCE.md", owner: "platform", description: "This platform: standards, registry, toolkit and AI-assisted development.", status: "live" },
  { id: "search-platform-doc", name: "Search & Discovery Platform", kind: "doc", source: "docs/SEARCH_PLATFORM.md", owner: "platform", description: "The unified search, ranking, SEO and AI-discovery layer, mapped to real code with a teeth-backed registry.", status: "live" },
  { id: "media-platform-doc", name: "Media Platform", kind: "doc", source: "docs/MEDIA_PLATFORM.md", owner: "platform", description: "The unified media services, storage, pipeline, delivery, AI and observability layer, mapped to real code with a teeth-backed registry.", status: "live" },

  /* ── Guides: onboarding for humans + AI ── */
  { id: "agents-guide", name: "AGENTS.md", kind: "guide", source: "AGENTS.md", owner: "platform", description: "How an AI assistant (or a new engineer) navigates the codebase, the standards and the golden rules.", status: "live" },
  { id: "readme", name: "README", kind: "guide", source: "README.md", owner: "platform", description: "First-run setup and the project overview.", status: "live" },

  /* ── Engineering Toolkit: generators + automation ── */
  { id: "gen-design-tokens", name: "Design token codegen", kind: "generator", source: "scripts/design-tokens.mjs", owner: "design", description: "Generates the CSS custom properties from the typed token set.", status: "live", command: "npm run tokens:generate" },
  { id: "gen-design-adoption", name: "Component adoption", kind: "generator", source: "scripts/design-adoption.mjs", owner: "design", description: "Measures real component adoption by counting imports across the tree.", status: "live", command: "npm run design:adoption" },
  { id: "gen-engineering-metrics", name: "Engineering metrics", kind: "generator", source: "scripts/engineering-metrics.mjs", owner: "platform", description: "DORA-style delivery metrics computed from git history.", status: "live", command: "npm run metrics:engineering" },
  { id: "gen-content-compile", name: "Content compiler", kind: "generator", source: "scripts/content-compile.mjs", owner: "content", description: "Compiles approved DB content to static TypeScript.", status: "live", command: "npm run content:compile" },
  { id: "gen-i18n", name: "i18n coverage", kind: "generator", source: "scripts/i18n.mjs", owner: "platform", description: "Measures translation coverage and runs the export/import pipeline.", status: "live", command: "npm run i18n:status" },
  { id: "gen-icons", name: "Icon generator", kind: "generator", source: "scripts/gen-icons.mjs", owner: "design", description: "Generates the PWA/brand icon assets.", status: "live" },

  /* ── SDK ── */
  { id: "sdk", name: "@frenzsave/sdk", kind: "sdk", source: "lib/sdk/index.ts", owner: "platform", description: "The dependency-free, cross-platform typed client over the public API.", status: "live" },

  /* ── Standards + the Architecture Navigator ── */
  { id: "standards", name: "Engineering Standards", kind: "standards", source: "lib/platform/engineering-standards.ts", owner: "platform", description: "The conventions (structure, naming, testing, errors…) as enforced data.", status: "live" },
  { id: "registry-of-registries", name: "Registry of Registries", kind: "registry", source: "lib/platform/registries.ts", owner: "platform", description: "The Architecture Navigator: every single-source-of-truth registry, mapped to real code.", status: "live" },

  /* ── Named by the brief, honestly not built ── */
  { id: "scaffold-generator", name: "Scaffold generator", kind: "template", source: "", owner: "platform", description: "One-command scaffolds for a feature / component / API route / migration / test.", status: "planned", note: "Generators exist for tokens/content/icons; a from-scratch feature scaffold is deferred — the patterns are documented in AGENTS.md and copied from a sibling today." },
  { id: "release-notes-generator", name: "Automated release notes", kind: "generator", source: "", owner: "platform", description: "Release notes generated from commit history.", status: "planned", note: "Commit messages are already structured (Conventional Commits); a generator over them is deferred." },
  { id: "sdk-version-registry", name: "SDK version registry", kind: "registry", source: "", owner: "platform", description: "Published SDK versions + changelog + compatibility.", status: "planned", note: "The SDK is in-repo (lib/sdk) and versioned with the app; a standalone npm release + version registry is deferred." },
  { id: "doc-usage-analytics", name: "Documentation usage analytics", kind: "registry", source: "", owner: "platform", description: "Which docs get read, and where onboarding stalls.", status: "planned", note: "Would need a docs portal with instrumentation; docs are Markdown in-repo today." },
];

export function getEngineeringAssets(): EngineeringAsset[] {
  return ENGINEERING_ASSETS;
}

export const ENGINEERING_ASSET_KINDS: { id: EngineeringAssetKind; label: string }[] = [
  { id: "doc", label: "Documentation" },
  { id: "guide", label: "Guides" },
  { id: "generator", label: "Generators & automation" },
  { id: "sdk", label: "SDK" },
  { id: "standards", label: "Standards" },
  { id: "registry", label: "Registries" },
  { id: "template", label: "Templates" },
];

export function assetsOfKind(kind: EngineeringAssetKind): EngineeringAsset[] {
  return ENGINEERING_ASSETS.filter((a) => a.kind === kind);
}

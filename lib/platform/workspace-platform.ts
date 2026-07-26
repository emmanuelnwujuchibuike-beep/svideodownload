/**
 * The Enterprise Workspace Framework, described by itself.
 *
 * The brief asks for a Workspace Registry, Loader, Shell Service, Navigation
 * Service, Plugin Manager, Workspace Gateway, lifecycle services, a micro-frontend
 * platform and a plugin framework — every Frenzsave product operating as an
 * independent-yet-integrated workspace on one Platform Kernel. As with the nine
 * platform maps before it, the honest starting point is that the KERNEL ALREADY
 * EXISTS and the substrate is a modular MONOLITH, not a micro-frontend mesh — so
 * this file maps what's live and marks the rest `planned`, never implied as done.
 *
 * What EXISTS today (do NOT rebuild — see docs/CONSTITUTION.md Article III, the
 * kernel):
 *   - the Workspace Registry = the Product Genome. Add a product = ONE entry in
 *     `lib/platform/modules.ts`; nav, RBAC, the launcher and search all derive from
 *     it (`lib/platform/module-registry.ts` is the contract),
 *   - the Platform Shell — one reusable authenticated frame (sidebar, topbar,
 *     mobile bottom nav, right rail) at `features/app-shell/app-shell.tsx`,
 *   - the Navigation Engine — one registry every surface is a VIEW over: command
 *     palette, workspace switcher, adaptive nav, search (`lib/navigation/*`),
 *   - the Service Registry — every shared gateway mapped to its real provider
 *     (`lib/platform/services.ts`), including the Workspace Gateway itself.
 *
 * ── The one honest position this map is built to hold ─────────────────────────
 *
 * This is a modular monolith. Its workspaces share auth, design, analytics,
 * observability and policy BY CONSTRUCTION, and they ship in one deploy. The
 * brief's "micro-frontend platform / independent deployment / plugin framework"
 * describes a DIFFERENT architecture — a scaling exit-path documented in
 * docs/INFRA_DECISIONS.md, not something pretended into existence here. So the
 * shared-platform rows are `live` (they are real and load-bearing) and the
 * independent-deployment / plugin / partner-extension rows are `planned`. Faking
 * them would be the exact "products that were never built" failure the Reality
 * Ledger exists to stop.
 *
 * Same truth rule as the rest of the kernel (docs/CONSTITUTION.md, Article I.3),
 * enforced by `workspace-platform.test.ts`: a `live`/`partial` row must point at a
 * file that exists; a `planned` row must not pretend to.
 */

import { getModules } from "./modules";
import type { PlatformModule } from "./module-registry";
import type { Access } from "./permissions";

export type WorkspaceStatus =
  /** A declared, load-bearing implementation in code. */
  | "live"
  /** Real and load-bearing, but a subset of the full brief. */
  | "partial"
  /** Named by the brief, not built. Honest placeholder, never implied as done. */
  | "planned";

/** The shared shape every source-backed catalogue row satisfies. */
interface CatalogueEntry {
  id: string;
  /** Repo-relative source of truth. Empty ONLY when `planned`. */
  source: string;
  status: WorkspaceStatus;
}

/* ─────────────────────────── registered workspaces ──────────────────────────
 * A VIEW over the Product Genome (`lib/platform/modules.ts`), NOT a second
 * declaration. Whether a workspace may be claimed as real is inherited from its
 * module's veracity, so this cannot drift into offering an environment that does
 * not exist — the same declare-then-derive honesty as SupportedLocales over the
 * locale registry. This is why it isn't a source-backed CatalogueEntry: its truth
 * comes from the genome, not from pointing at a file.
 */

export interface RegisteredWorkspace {
  id: string;
  name: string;
  shortName: string;
  tagline: string;
  basePath: string;
  /** Display maturity badge. */
  status: PlatformModule["status"];
  /** Real build stage from the Reality Ledger. */
  stage: PlatformModule["veracity"]["stage"];
  /** May we state, present-tense, that it exists? */
  claimable: boolean;
  /** A route that proves it, when claimable. */
  provingRoute: string | null;
  /** The access tier that may open it. */
  tier: "everyone" | "pro" | "business" | "admin";
}

/** Lowest access tier that may open a module, for the operator view. */
function tierOf(m: PlatformModule): RegisteredWorkspace["tier"] {
  // Probe the module's REAL predicate with representative principals rather than
  // re-encoding the tier here — so this label can never disagree with the gate.
  const everyone: Access = { plan: "free", isAdmin: false };
  const pro: Access = { plan: "pro", isAdmin: false };
  const business: Access = { plan: "business", isAdmin: false };
  if (m.canAccess(everyone)) return "everyone";
  if (m.canAccess(pro)) return "pro";
  if (m.canAccess(business)) return "business";
  return "admin";
}

export function getRegisteredWorkspaces(): RegisteredWorkspace[] {
  return getModules().map((m) => ({
    id: m.id,
    name: m.name,
    shortName: m.shortName,
    tagline: m.tagline,
    basePath: m.basePath,
    status: m.status,
    stage: m.veracity.stage,
    claimable: m.veracity.claimable,
    provingRoute: m.veracity.provingRoute ?? null,
    tier: tierOf(m),
  }));
}

/* ─────────────────────────── framework services ─────────────────────────────
 * The brief's Backend Architecture list, mapped to the real provider of each. In
 * a modular monolith a "service" is the module that owns a capability, not a
 * separate process — so this catalogues real providers, honestly staged, rather
 * than fabricating empty service shells.
 */

export interface FrameworkService extends CatalogueEntry {
  name: string;
  capability: string;
  note?: string;
}

export const FRAMEWORK_SERVICES: FrameworkService[] = [
  { id: "workspace-registry", name: "Workspace Registry", source: "lib/platform/modules.ts", status: "live", capability: "The single source of truth for every product; add a workspace = one entry. Nav, RBAC, launcher and search all derive from it." },
  { id: "workspace-contract", name: "Workspace Contract", source: "lib/platform/module-registry.ts", status: "live", capability: "The `PlatformModule` shape every workspace registers against — id, name, basePath, access predicate, nav, status + Reality-Ledger veracity." },
  { id: "workspace-gateway", name: "Workspace Gateway", source: "lib/platform/modules.ts", status: "live", capability: "Resolves the workspace that owns a path (`resolveModule`) and the set a visitor may open (`getModulesFor`) — the switching + routing seam." },
  { id: "workspace-loader", name: "Workspace Loader", source: "lib/platform/modules.ts", status: "partial", capability: "Load-time resolution of the active workspace from the URL.", note: "In a monolith every workspace is already in the bundle; a dynamic remote loader belongs to the micro-frontend path (planned), so this is resolution-only." },
  { id: "shell-service", name: "Shell Service", source: "features/app-shell/app-shell.tsx", status: "live", capability: "One reusable authenticated frame (sidebar, topbar, mobile bottom nav, right rail, download dock, toaster) hosting every workspace." },
  { id: "navigation-service", name: "Navigation Service", source: "lib/navigation/queries.ts", status: "live", capability: "Command palette, workspace switcher, adaptive nav and search — all VIEWS over one nav registry; every destination is route-verified." },
  { id: "analytics-service", name: "Workspace Analytics", source: "lib/analytics/events.ts", status: "partial", capability: "The unified event pipeline every workspace fires into.", note: "Events + nav ids exist; a per-workspace adoption/flow dashboard (Workspace Intelligence™) is planned." },
  { id: "health-service", name: "Workspace Health Service", source: "lib/platform/certification.ts", status: "partial", capability: "Production-readiness certifications computed from the governance gates.", note: "Platform-wide gates + certs are live; per-workspace health scoring/uptime is planned." },
  { id: "communication", name: "Workspace Communication (event bus)", source: "lib/platform/event-bus.ts", status: "partial", capability: "Typed in-process publish/subscribe over the domain-event contracts — the cross-workspace event seam.", note: "The bus + contracts are real and observable, but have ZERO producers today — dormant plumbing until a real code path calls emit()." },
  { id: "admin-dashboard", name: "Administrative Dashboard", source: "app/admin/page.tsx", status: "live", capability: "Operate every workspace + the platform from one dashboard; this framework map is a section in it." },
  { id: "registry", name: "Workspace Framework Registry", source: "lib/platform/workspace-platform.ts", status: "live", capability: "This file — the catalogued map of workspaces, framework services, shell, navigation, lifecycle and extensibility that every product inherits." },
  { id: "plugin-manager", name: "Plugin Manager", source: "", status: "planned", capability: "Install, sandbox, permission and version optional first/third-party extensions." },
  { id: "lifecycle-service", name: "Workspace Lifecycle Service", source: "", status: "planned", capability: "A runtime service for install / activate / upgrade / deprecate / migrate / remove.", note: "Lifecycle STATES exist on the module (status + veracity) and activation runs through feature flags; a dedicated lifecycle service does not." },
];

/* ─────────────────────────────── platform shell ─────────────────────────────
 * The brief's Platform Shell — one reusable application shell. Each capability
 * maps to the real component that provides it.
 */

export interface ShellCapability extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const SHELL_CAPABILITIES: ShellCapability[] = [
  { id: "global-nav", name: "Global navigation (sidebar)", source: "features/app-shell/app-sidebar.tsx", status: "live", description: "The left rail, built from the modules a visitor can access." },
  { id: "top-nav", name: "Top navigation", source: "features/app-shell/app-topbar.tsx", status: "live", description: "The app top bar — search entry, notifications, profile." },
  { id: "bottom-nav", name: "Bottom navigation", source: "features/app-shell/mobile-nav.tsx", status: "live", description: "The mobile bottom bar — the primary nav on a phone." },
  { id: "workspace-switching", name: "Workspace switching", source: "lib/navigation/queries.ts", status: "partial", description: "`availableWorkspaces()` filters the switcher to workspaces whose product is claimable.", note: "The switcher data + gate are live; today only two products are claimable, so the switcher is deliberately quiet." },
  { id: "notifications", name: "Notifications", source: "features/app-shell/notification-bell.tsx", status: "live", description: "Shared notification bell + realtime badge across every workspace." },
  { id: "universal-search", name: "Universal search (⌘K)", source: "lib/navigation/queries.ts", status: "live", description: "One command palette over destinations, commands and content." },
  { id: "theme", name: "Theme", source: "lib/platform/design-tokens.ts", status: "live", description: "One typed token set; light/dark via next-themes, CSS generated from the tokens." },
  { id: "localization", name: "Localization", source: "lib/i18n/messages/index.ts", status: "partial", description: "Shared string catalogue with per-key fallback (Globalization Platform).", note: "Chrome is wired; most workspace surfaces are still English-only." },
  { id: "profile", name: "Profile access", source: "features/app-shell/app-topbar.tsx", status: "live", description: "The account menu, present in the shell on every route." },
  { id: "settings", name: "Settings", source: "app/(app)/account", status: "live", description: "Shared account, security, privacy and preference surfaces." },
  { id: "global-commands", name: "Global commands", source: "lib/navigation/registry.ts", status: "live", description: "Create / navigate / account / appearance / admin actions, declared once and rendered by the palette." },
];

/* ─────────────────────────────── navigation engine ──────────────────────────
 * The brief's Navigation Engine. Maps to the nav registry, module routing and the
 * shell's real history/offline pieces — or honestly `planned`.
 */

export interface NavigationCapability extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const NAVIGATION_ENGINE: NavigationCapability[] = [
  { id: "nav-registry", name: "Nested navigation", source: "lib/navigation/registry.ts", status: "live", description: "Destinations grouped by workspace + kind; every href is route-verified by a test." },
  { id: "workspace-routing", name: "Workspace routing", source: "lib/platform/modules.ts", status: "live", description: "`resolveModule` maps any path to its owning workspace by longest basePath match." },
  { id: "cross-workspace", name: "Cross-workspace navigation", source: "lib/navigation/queries.ts", status: "live", description: "`workspaceDestinations()` + the palette move a user between workspaces from anywhere." },
  { id: "deep-linking", name: "Deep linking", source: "app/(app)/layout.tsx", status: "partial", description: "Next App Router gives every workspace surface a real, shareable URL.", note: "Web deep links are native to the router; a resolver mapping external/native links to in-app routes is the universal-links row below." },
  { id: "history-restoration", name: "History restoration", source: "features/app-shell/page-transition.tsx", status: "partial", description: "Directional page transitions + edge-swipe-back preserve a sense of the nav stack.", note: "Scroll/position restoration is the router's default; a full saved-history model per workspace is planned." },
  { id: "offline-nav", name: "Offline navigation", source: "features/app-shell/offline-queue-sync.tsx", status: "partial", description: "PWA service worker + an offline banner + a queued-write sync keep the shell usable offline.", note: "Cached shell + queue are real; full offline route pre-caching per workspace is planned." },
  { id: "quick-actions", name: "Quick actions", source: "lib/navigation/registry.ts", status: "live", description: "Create/command entries surfaced in the palette and the shell." },
  { id: "universal-links", name: "Universal links", source: "", status: "planned", description: "OS-level app links / deep-link resolver — needs a native app, which does not exist (PWA)." },
  { id: "breadcrumbs", name: "Breadcrumbs", source: "", status: "planned", description: "A derived breadcrumb trail from the nav registry hierarchy." },
];

/* ───────────────────────── lifecycle + micro-frontend ────────────────────────
 * The brief's Workspace Lifecycle + Micro-Frontend Platform. This is where the
 * modular-monolith honesty lives: what is genuinely SHARED is live; INDEPENDENT
 * deployment/evolution is the deliberate architectural exit-path, planned.
 */

export interface LifecycleCapability extends CatalogueEntry {
  name: string;
  /** "lifecycle" | "shared" | "independence" grouping for the operator view. */
  kind: "lifecycle" | "shared" | "independence";
  description: string;
  note?: string;
}

export const LIFECYCLE_AND_PLATFORM: LifecycleCapability[] = [
  // Lifecycle
  { id: "status-states", name: "Lifecycle states", kind: "lifecycle", source: "lib/platform/module-registry.ts", status: "live", description: "Every workspace declares a maturity (live/beta/soon) + a Reality-Ledger stage (live→concept) — the states a product moves through." },
  { id: "activation", name: "Activation / enablement", kind: "lifecycle", source: "lib/platform/flags.ts", status: "live", description: "Feature flags turn a workspace or capability on/off at runtime with rollout %, plan gates and kill switches." },
  { id: "configuration", name: "Configuration", kind: "lifecycle", source: "lib/platform/config-registry.ts", status: "live", description: "Every runtime-configurable surface + an audited change history." },
  { id: "migration", name: "Migration", kind: "lifecycle", source: "supabase/migrations", status: "live", description: "Versioned schema evolution; each table ships its RLS in the same migration." },
  { id: "initialization", name: "Initialization", kind: "lifecycle", source: "instrumentation.ts", status: "partial", description: "One Next startup hook wires observability once, at zero request cost.", note: "Platform init is real; per-workspace init/teardown hooks are planned." },
  { id: "install-upgrade", name: "Install / upgrade / remove", kind: "lifecycle", source: "", status: "planned", description: "Runtime install/upgrade/deprecate/remove of a workspace — a deploy-time concern in a monolith, not a runtime service." },
  // Shared platform (live by construction)
  { id: "shared-auth", name: "Shared authentication", kind: "shared", source: "lib/auth/request-user.ts", status: "live", description: "One Supabase session powers every workspace; server-side user resolution." },
  { id: "shared-design", name: "Shared design system", kind: "shared", source: "lib/platform/component-registry.ts", status: "live", description: "One component library + token set every workspace renders with." },
  { id: "shared-analytics", name: "Shared analytics", kind: "shared", source: "lib/analytics/events.ts", status: "live", description: "One event pipeline; workspaces never wire their own." },
  { id: "shared-observability", name: "Shared observability", kind: "shared", source: "lib/observability/trace.ts", status: "partial", description: "In-process spans + metrics + event metering, wired once.", note: "Per-instance (real); distributed tracing across web + worker is planned." },
  { id: "shared-policies", name: "Shared policies", kind: "shared", source: "lib/platform/permissions.ts", status: "live", description: "One access model + governance manifest every workspace is gated by." },
  // Independence (the micro-frontend exit-path — planned)
  { id: "boundaries", name: "Enforced module boundaries", kind: "independence", source: ".eslintrc.json", status: "partial", description: "`no-restricted-imports` blocks reaching into another module's internals, so a workspace can evolve behind its public barrel.", note: "Boundaries are enforced; but everything still ships in ONE deploy — this is a monolith, not a mesh." },
  { id: "independent-deploy", name: "Independent deployment", kind: "independence", source: "", status: "planned", description: "Ship one workspace without redeploying the rest — the micro-frontend exit-path (docs/INFRA_DECISIONS.md)." },
  { id: "version-compat", name: "Version compatibility", kind: "independence", source: "", status: "planned", description: "Contract-versioned shells + workspaces that can run at different versions." },
];

/* ───────────────────────── extensibility + AI (plugins) ──────────────────────
 * The brief's Plugin Framework + AI Platform Integration. The plugin framework is
 * entirely `planned` (a security-sensitive extension sandbox that does not exist).
 * AI UNDERSTANDING, by contrast, has a real substrate: the machine-readable
 * registries + AGENTS.md already let an AI reason about the platform — those are
 * `live`; a runtime assistant that acts on that understanding is `planned`.
 */

export interface ExtensibilityCapability extends CatalogueEntry {
  name: string;
  /** "plugin" | "ai" grouping. */
  kind: "plugin" | "ai";
  description: string;
  note?: string;
}

export const EXTENSIBILITY_AND_AI: ExtensibilityCapability[] = [
  // AI understanding — real, machine-readable substrate
  { id: "ai-onboarding", name: "AI + human onboarding", kind: "ai", source: "AGENTS.md", status: "live", description: "The entry point that teaches an AI (or human) to navigate the platform via its registries." },
  { id: "ai-registries", name: "Machine-readable registries", kind: "ai", source: "lib/platform/registries.ts", status: "live", description: "The Registry-of-Registries — an AI can enumerate every workspace, service and contract from code." },
  { id: "ai-service-contracts", name: "Service contracts", kind: "ai", source: "lib/platform/services.ts", status: "live", description: "Every shared gateway mapped to its provider, so dependencies are inspectable." },
  { id: "ai-api-contracts", name: "API contracts", kind: "ai", source: "lib/platform/api-registry.ts", status: "live", description: "Every public endpoint with method/path/auth, enforced against the real routes." },
  { id: "ai-event-contracts", name: "Domain-event contracts", kind: "ai", source: "lib/platform/domain-events.ts", status: "live", description: "Typed business-event contracts an AI can reason about for cross-workspace flows." },
  { id: "ai-runtime", name: "Runtime workspace reasoning", kind: "ai", source: "", status: "planned", description: "An assistant that reasons over live workspace state/capabilities to help a user or developer act." },
  // Plugin framework — planned
  { id: "plugin-runtime", name: "Plugin runtime / sandbox", kind: "plugin", source: "", status: "planned", description: "A permissioned, isolated runtime for optional extensions." },
  { id: "plugin-marketplace", name: "Marketplace plugins", kind: "plugin", source: "", status: "planned", description: "Extensions for the (concept-stage) Marketplace workspace." },
  { id: "plugin-ai", name: "AI plugins", kind: "plugin", source: "", status: "planned", description: "Assistant/tool extensions." },
  { id: "plugin-business", name: "Business plugins", kind: "plugin", source: "", status: "planned", description: "Extensions for business/professional workspaces." },
  { id: "plugin-developer", name: "Developer plugins", kind: "plugin", source: "", status: "planned", description: "First-party developer extensions over the API/SDK." },
  { id: "plugin-partners", name: "Approved partner integrations", kind: "plugin", source: "", status: "planned", description: "Governed third-party modules — needs the plugin runtime + a review pipeline first." },
];

/* ─────────────────────────────────── reads ──────────────────────────────────── */

export function getFrameworkServices(): FrameworkService[] {
  return FRAMEWORK_SERVICES;
}
export function getShellCapabilities(): ShellCapability[] {
  return SHELL_CAPABILITIES;
}
export function getNavigationEngine(): NavigationCapability[] {
  return NAVIGATION_ENGINE;
}
export function getLifecycleAndPlatform(): LifecycleCapability[] {
  return LIFECYCLE_AND_PLATFORM;
}
export function getExtensibilityAndAi(): ExtensibilityCapability[] {
  return EXTENSIBILITY_AND_AI;
}

/** Every source-backed row, for the platform-health summary + teeth. */
export function workspacePlatformEntries(): CatalogueEntry[] {
  return [
    ...FRAMEWORK_SERVICES,
    ...SHELL_CAPABILITIES,
    ...NAVIGATION_ENGINE,
    ...LIFECYCLE_AND_PLATFORM,
    ...EXTENSIBILITY_AND_AI,
  ];
}

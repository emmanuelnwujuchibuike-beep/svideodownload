/**
 * Global Navigation Engine™ — the type layer.
 *
 * ── Why a registry comes before any UI ─────────────────────────────────────────
 *
 * The brief asks for a command palette, a workspace switcher, adaptive navigation,
 * global search and navigation analytics. Built separately those are five systems
 * that each hold their own copy of "where can you go and what can you do", and they
 * drift the moment a route is added. Built over one registry they are five VIEWS:
 *
 *   command palette   → the registry, ranked by a query
 *   workspace switcher→ the registry, grouped by workspace
 *   adaptive nav      → the registry, filtered by access
 *   global search     → the registry, plus content from the Experience Graph
 *   nav analytics     → events keyed by registry id
 *
 * So the registry is built first and the surfaces come after. This is the same
 * reason the Product Genome preceded the landing page in the content platform.
 *
 * ── Honesty ───────────────────────────────────────────────────────────────────
 *
 * A destination that 404s is the navigation equivalent of a fabricated stat: the
 * interface asserts something the product cannot honour. Every `Destination` is
 * therefore checked against the real route tree by `navigation.test.ts`, and
 * workspaces inherit `claimable` from the Product Genome so the switcher can never
 * offer an environment that does not exist.
 */
import type { LucideIcon } from "lucide-react";

import type { ModuleAccess } from "@/lib/platform/module-registry";

/* -------------------------------- workspaces -------------------------------- */

/**
 * The environments a person can be working in.
 *
 * The brief names eleven. Only the ones backed by a real product are ever offered;
 * the rest stay declared so the type is stable as products ship, which is cheaper
 * than widening a union later and re-auditing every switch over it.
 */
export type WorkspaceId =
  | "social"
  | "creator"
  | "business"
  | "marketplace"
  | "professional"
  | "community"
  | "cloud"
  | "learning"
  | "ai"
  | "developer"
  | "enterprise";

export interface Workspace {
  id: WorkspaceId;
  name: string;
  tagline: string;
  icon: LucideIcon;
  accent: string;
  /** Where entering this workspace lands. Must be a real route. */
  home: string;
  /**
   * The genome product this workspace is an environment for. Its veracity decides
   * whether the workspace may be offered at all — see `availableWorkspaces()`.
   */
  productId: string;
  canAccess: (access: ModuleAccess) => boolean;
}

/* ------------------------------- destinations ------------------------------- */

/** What a registry entry is for, used for grouping and iconography. */
export type DestinationKind =
  | "page"
  | "product"
  | "setting"
  | "account"
  | "create"
  | "docs"
  | "admin";

export interface Destination {
  /** Stable id. Analytics key and React key; never reuse or rename. */
  id: string;
  label: string;
  /** Concrete route. Asserted to exist by the test suite. */
  href: string;
  kind: DestinationKind;
  icon: LucideIcon;
  /** Workspace this belongs to, when it is workspace-scoped. */
  workspace?: WorkspaceId;
  /**
   * Extra terms that should match this entry in search — synonyms, old names, and
   * the words people actually type. "logout" finds Sign out; "dark mode" finds
   * Appearance. Without these a palette only works for people who already know the
   * product's vocabulary, which is exactly the group that needs it least.
   */
  keywords?: string[];
  /** Short line under the label in the palette. */
  hint?: string;
  canAccess: (access: ModuleAccess) => boolean;
  /** Signed-in only. Hidden from guests rather than bouncing them to /login. */
  requiresAuth?: boolean;
}

/* --------------------------------- commands --------------------------------- */

/**
 * An action rather than a place.
 *
 * Deliberately separate from `Destination`: a command may open a modal, toggle a
 * setting or start a flow, and modelling those as fake hrefs would mean every
 * consumer special-cases them. The palette renders both; only this one carries a
 * `run`.
 */
export interface Command {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords?: string[];
  hint?: string;
  /** Grouping in the palette. */
  group: "create" | "navigate" | "account" | "appearance" | "admin";
  canAccess: (access: ModuleAccess) => boolean;
  requiresAuth?: boolean;
  /**
   * Where the command goes, when it is expressible as a route. Commands that need
   * client behaviour (theme, sign out) are wired by the palette instead — this
   * registry stays free of React so it can be imported anywhere, including tests
   * and the server.
   */
  href?: string;
  /** Client-side action id the palette maps to a handler. */
  action?: "toggle-theme" | "sign-out" | "copy-link" | "install-app";
}

/* --------------------------------- results ---------------------------------- */

/** A palette/search hit, with the score that ranked it. */
export interface NavResult {
  kind: "destination" | "command";
  id: string;
  label: string;
  href?: string;
  hint?: string;
  icon: LucideIcon;
  score: number;
}

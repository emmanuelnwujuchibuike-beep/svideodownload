/**
 * Platform module contract.
 *
 * A "product" in the Frenzsave ecosystem (Download, Community, Studio, Cloud, AI,
 * Admin, …) is a *module*. This file defines the shape of a module and the access
 * predicates used to gate it. The actual registry of modules lives in `./modules`.
 *
 * Adding a product = adding one entry to `MODULES` in `./modules`. The app shell,
 * RBAC gating, and search all derive from that single source — nothing else needs
 * to change. See `docs/ARCHITECTURE.md`.
 *
 * This file is intentionally dependency-light (types + pure predicates only) so it
 * is safe to import from both Server Components (RBAC) and Client Components (nav)
 * without pulling anything heavy into a bundle.
 */
import type { LucideIcon } from "lucide-react";

import {
  ANON_ACCESS,
  type Access,
  adminOnly,
  businessOnly,
  everyone,
  proOnly,
} from "@/lib/platform/permissions";

/**
 * The current visitor's access level, as seen by a module gate. The permission
 * model — this type plus the access predicates below — is declared by the Permission
 * Registry (`lib/platform/permissions.ts`) and re-exported here so the module
 * contract's many importers are unchanged.
 */
export type ModuleAccess = Access;

export type ModuleStatus = "live" | "beta" | "soon";

/**
 * The Reality Ledger, made structural.
 *
 * Marketing surfaces may only state that a product EXISTS when its genome says so.
 * This is enforced by `lib/content/reality-ledger.test.ts`, not by discipline —
 * the site has previously shipped copy for products that were never built, and
 * front-door claims that were off by four orders of magnitude.
 *
 * `status` answers "how finished is it?" (a user-facing maturity badge).
 * `veracity` answers "may we say it exists?" (a truth gate). They are deliberately
 * separate: a `beta` product is real and claimable; a `soon` product is neither.
 */
export interface ProductVeracity {
  /** Real build stage. Narrower than `status`, which is a display concern. */
  stage: "live" | "beta" | "alpha" | "internal" | "planned" | "concept";
  /**
   * May marketing copy state, in the present tense, that this exists?
   * `false` ⇒ every surface must use future/conditional tense ("coming", "planned").
   */
  claimable: boolean;
  /**
   * A route that proves the product is real. Asserted to exist by the ledger test
   * for every `claimable` product — a claim with no reachable product is the exact
   * failure mode this field exists to catch.
   */
  provingRoute?: string;
  /** Commit, PR or migration that shipped it. Free text; for humans reviewing drift. */
  evidence?: string;
  /** ISO date a human last confirmed this record against the running product. */
  verifiedAt?: string;
}

/** A navigation entry a module contributes to the shared app shell. */
export interface ModuleNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Optional badge text (e.g. "New", "5"). */
  badge?: string;
}

export interface PlatformModule {
  /** Stable, unique, kebab-case id. Never reuse or rename. e.g. "download". */
  id: string;
  /** Display name shown to users. e.g. "Frenzsave Download". */
  name: string;
  /** Short name for compact nav/menus. e.g. "Download". */
  shortName: string;
  /** One line for menus, the app launcher, and search. */
  tagline: string;
  /** Route subtree this module owns, e.g. "/downloads". Used for active-route match. */
  basePath: string;
  icon: LucideIcon;
  /** Tailwind gradient classes for the module's brand chip/card. */
  accent: string;
  status: ModuleStatus;
  /** Truth gate for marketing copy. See {@link ProductVeracity}. */
  veracity: ProductVeracity;
  /** Whether the given visitor may open this module. */
  canAccess: (access: ModuleAccess) => boolean;
  /** Nav entries this module contributes to the app shell (optional). */
  nav?: ModuleNavItem[];
}

/* ----------------------------- access predicates ----------------------------- */
// Declared by the Permission Registry; re-exported so existing importers are unchanged.
export { ANON_ACCESS, adminOnly, businessOnly, everyone, proOnly };

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

import type { BillingPlan } from "@/lib/monetization/types";

/** The current visitor's access level, as seen by a module gate. */
export interface ModuleAccess {
  plan: BillingPlan;
  isAdmin: boolean;
}

export type ModuleStatus = "live" | "beta" | "soon";

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
  /** Whether the given visitor may open this module. */
  canAccess: (access: ModuleAccess) => boolean;
  /** Nav entries this module contributes to the app shell (optional). */
  nav?: ModuleNavItem[];
}

/* ----------------------------- access predicates ----------------------------- */

export const everyone = (): boolean => true;
export const proOnly = (a: ModuleAccess): boolean => a.plan !== "free";
export const businessOnly = (a: ModuleAccess): boolean => a.plan === "business";
export const adminOnly = (a: ModuleAccess): boolean => a.isAdmin;

/** Default access used when a caller has no session context yet. */
export const ANON_ACCESS: ModuleAccess = { plan: "free", isAdmin: false };

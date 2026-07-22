/**
 * Permission Registry — the single declared source for the platform's access model.
 *
 * The brief's "Permission Registry™". The predicates that gate every module and nav
 * entry (`everyone` / `proOnly` / `businessOnly` / `adminOnly`) used to live inside
 * `module-registry.ts`; they are the access model, so they belong here, declared once
 * as named CAPABILITIES. `module-registry.ts` now re-exports them, so nothing that
 * imports `ModuleAccess` / the predicates changed.
 *
 * Scope, honestly: this is the CODE-side authorization model — plan tiers + admin,
 * expressed as pure predicates over an `Access` principal. The row-level half (RLS
 * policies, `public.is_admin()`) lives in the database migrations and is a separate,
 * deliberately independent layer (defense in depth — see docs/SECURITY.md). This
 * registry does not, and should not, try to mirror every RLS policy.
 *
 * Dependency-light (types + pure predicates), so it is safe in a Server Component
 * (RBAC gating) and a Client Component (nav) alike.
 */
import type { BillingPlan } from "@/lib/monetization/types";

/** A principal's access level, as any code gate sees it. */
export interface Access {
  plan: BillingPlan;
  isAdmin: boolean;
}

/** Default access for a caller with no session context yet. */
export const ANON_ACCESS: Access = { plan: "free", isAdmin: false };

/* ----------------------------- access predicates ----------------------------- */

export const everyone = (): boolean => true;
export const proOnly = (a: Access): boolean => a.plan !== "free";
export const businessOnly = (a: Access): boolean => a.plan === "business";
export const adminOnly = (a: Access): boolean => a.isAdmin;

/* ------------------------------- capabilities -------------------------------- */

/** A named capability and the predicate that grants it. */
export interface Capability {
  /** Stable, unique, kebab-case id. */
  id: string;
  label: string;
  description: string;
  grants: (a: Access) => boolean;
}

export const CAPABILITIES: Capability[] = [
  { id: "public", label: "Public", description: "Everyone, signed in or not.", grants: everyone },
  { id: "pro", label: "Pro", description: "Pro and Business plans (any paid tier).", grants: proOnly },
  { id: "business", label: "Business", description: "Business plan only.", grants: businessOnly },
  { id: "admin", label: "Admin", description: "Operate the platform. Never surfaced in marketing.", grants: adminOnly },
];

/** Does this principal hold the named capability? Unknown id ⇒ false (fail closed). */
export function can(access: Access, capabilityId: string): boolean {
  return CAPABILITIES.find((c) => c.id === capabilityId)?.grants(access) ?? false;
}

/** All declared capabilities, in declaration order. */
export function getCapabilities(): Capability[] {
  return CAPABILITIES;
}

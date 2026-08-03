/**
 * Universal Profile Engine™ — layout resolution (Feature 18 · Part 14).
 *
 * One pure function decides what a profile shows. Everything that could make a
 * module appear or disappear is an INPUT, so the answer is reproducible, and
 * the privacy-critical part of the profile is unit-testable without a database,
 * a session or a browser.
 *
 * Four things gate a module, in this order:
 *
 *   1. TYPE      — does this profile type offer it at all? (`modules.ts`)
 *   2. CHOICE    — has the member enabled it? (`profile_modules`, else the
 *                  type's defaults for a member who never opened Settings)
 *   3. AUDIENCE  — is this viewer entitled to it? (`audience.ts`)
 *   4. SUBSTANCE — is there anything in it? Empty modules are hidden from
 *                  visitors and kept for the owner, who needs the empty state
 *                  to know it exists.
 *
 * Gate 4 is the one that keeps the platform honest. A profile that declares
 * ten modules and has filled in two shows two — a visitor is never sent to a
 * tab that turns out to be a placeholder.
 *
 * Pure: no React, no Supabase, no I/O.
 */

import { canSeeModule, type ViewerRole } from "@/lib/profile/audience";
import {
  DEFAULT_MODULE_AUDIENCE,
  modulesForType,
  profileModule,
  type AudienceKey,
  type ModuleKey,
  type ModuleSpec,
} from "@/lib/profile/modules";
import { profileType, type ProfileTypeKey } from "@/lib/profile/profile-types";

/** One member's stored preference for one module. */
export interface StoredModule {
  moduleKey: string;
  enabled: boolean;
  position: number;
  audience: AudienceKey;
}

export interface ResolvedModule {
  key: ModuleKey;
  spec: ModuleSpec;
  position: number;
  audience: AudienceKey;
  /** True when the module has real content; false = owner-only empty state. */
  hasContent: boolean;
}

/** A module plus the member's own on/off choice — what Settings renders. */
export interface EffectiveModule extends ResolvedModule {
  enabled: boolean;
}

export interface ResolveInput {
  type: ProfileTypeKey;
  /** Rows from `profile_modules`; empty = this member has never customised. */
  stored: StoredModule[];
  /** The member's chosen landing module, if any. */
  landing: string | null;
  role: ViewerRole;
  /**
   * Which modules actually hold something. A key absent from the map is
   * treated as EMPTY — a module must prove it has content, never assume it.
   */
  content: Partial<Record<ModuleKey, boolean>>;
  /**
   * Modules whose visibility is decided by an older, per-tab privacy setting
   * (Reposts / Wows / Saved). Those settings predate modules and remain the
   * authority, so the engine only ever narrows them further, never widens.
   */
  allowedGoverned?: ModuleKey[];
}

export interface ResolvedLayout {
  /** Visible to THIS viewer, in the member's order. */
  modules: ResolvedModule[];
  /** Where this viewer lands. Always a member of `modules` when non-empty. */
  landing: ModuleKey | null;
}

/**
 * The member's effective preferences for every module their type offers —
 * stored rows where they exist, the type's defaults where they don't. This is
 * also what the Modules settings screen renders, so the switch a member sees is
 * literally the state the profile resolves from.
 */
export function effectiveModules(type: ProfileTypeKey, stored: StoredModule[]): EffectiveModule[] {
  const spec = profileType(type);
  const storedBy = new Map(stored.map((s) => [s.moduleKey, s]));

  return modulesForType(type)
    .filter((m) => m.status === "live")
    .map((m, catalogueIndex): EffectiveModule => {
      const row = storedBy.get(m.key);
      const defaultIndex = spec.defaultModules.indexOf(m.key);
      const onByDefault = defaultIndex >= 0;
      return {
        key: m.key,
        spec: m,
        // A member who has never touched a module gets their type's default —
        // so a brand-new Business profile is useful before it is configured.
        enabled: row ? row.enabled : onByDefault,
        // Stored order wins; otherwise the type's default order, and anything
        // the type doesn't name falls in behind it in catalogue order.
        position: row?.position ?? (onByDefault ? defaultIndex : 100 + catalogueIndex),
        audience: row?.audience ?? DEFAULT_MODULE_AUDIENCE,
        hasContent: false,
      };
    })
    .sort((a, b) => a.position - b.position);
}

/** The full resolution — the function the profile page calls. */
export function resolveProfileLayout(input: ResolveInput): ResolvedLayout {
  const governed = new Set(input.allowedGoverned ?? []);
  const isOwner = input.role === "owner";

  const visible: ResolvedModule[] = effectiveModules(input.type, input.stored)
    .filter((m) => m.enabled)
    .map(({ enabled: _enabled, ...m }) => ({ ...m, hasContent: input.content[m.key] === true }))
    .filter((m) => {
      // Gate 3 — audience.
      if (!canSeeModule(input.role, m.audience)) return false;
      // The three legacy tabs answer to their own privacy setting first.
      if (m.spec.governedElsewhere && !isOwner && !governed.has(m.key)) return false;
      // Gate 4 — substance. The owner keeps every enabled module so they can
      // fill it in; a visitor only ever sees modules that hold something.
      if (!isOwner && !m.hasContent) return false;
      return true;
    });

  return { modules: visible, landing: pickLanding(input, visible) };
}

function pickLanding(input: ResolveInput, visible: ResolvedModule[]): ModuleKey | null {
  if (visible.length === 0) return null;
  const has = (k: string | null | undefined): ModuleKey | null => {
    if (!k) return null;
    const found = visible.find((m) => m.key === k);
    return found ? found.key : null;
  };
  // The member's choice, then their type's default, then whatever is first.
  return has(input.landing) ?? has(profileType(input.type).defaultLanding) ?? visible[0]!.key;
}

/**
 * Is `key` a module this type offers and this platform can actually serve?
 * The API's guard — a member cannot enable "Reviews" (planned) or a module
 * their type doesn't offer, whatever the request body says.
 */
export function canEnableModule(type: ProfileTypeKey, key: string): boolean {
  const spec = profileModule(key);
  if (!spec || spec.status !== "live") return false;
  return spec.types === "all" || spec.types.includes(type);
}

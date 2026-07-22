import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { recordConfigChange } from "./config-audit";
import {
  type FeatureFlag,
  type FlagContext,
  type FlagOverride,
  getFlag,
  getFlags,
  resolveFlagWithDeps,
} from "./flags";

/**
 * Server-only read/write for feature-flag OVERRIDES (the admin-editable half).
 *
 * Overrides live in the `feature_flags` table and are read through the
 * service-role client — the same access model as `lib/monetization/settings.ts`:
 * operator config, never touched by a user session. The registry + resolver in
 * `./flags` stay pure and importable anywhere; this file is where the I/O is, and
 * `import "server-only"` makes accidentally bundling it into the client a build
 * error rather than a leak.
 *
 * ── Degrades to declared defaults ─────────────────────────────────────────────
 *
 * Migrations here are applied by hand, so the read MUST NOT depend on the table
 * existing. Any failure — table absent (Postgres 42P01), Supabase unconfigured, a
 * transient error — resolves to "no overrides", i.e. every flag falls back to its
 * declared `defaultEnabled`/`rollout`. Shipping the code before the migration is
 * therefore safe: nothing changes until both the table and an override exist.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

type OverrideMap = Record<string, FlagOverride>;

let cache: { at: number; value: OverrideMap } | null = null;
/*
  Short TTL: a flag override is a kill switch, so "I turned it off and it is still
  on" must resolve in seconds. `setFlagOverride` clears this instance's cache on
  write, but other instances in a multi-instance deploy keep their copy until this
  expires — so this is the real ceiling on propagation. Matches the 10s used for
  the monetization switches for the same reason.
*/
const TTL_MS = 10_000;

/** All persisted overrides, keyed by flag id. `{}` when unconfigured or on error. */
export async function getFlagOverrides(): Promise<OverrideMap> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (!hasSupabase) return {};
  try {
    const db = createAdminClient();
    // `select("*")` is forward/backward compatible: the schedule columns (0093)
    // come through when present and are simply absent otherwise — so a lagging
    // migration degrades to "no schedule", not a failed read.
    const { data, error } = await db.from("feature_flags").select("*");
    // Missing table / any error ⇒ no overrides, defaults win. Never throw.
    if (error || !data) return cache?.value ?? {};
    const map: OverrideMap = {};
    for (const row of data as Record<string, unknown>[]) {
      map[row.id as string] = {
        enabled: (row.enabled as boolean | null) ?? null,
        rolloutPercentage: (row.rollout_percentage as number | null) ?? null,
        activeFrom: (row.active_from as string | null) ?? null,
        activeUntil: (row.active_until as string | null) ?? null,
      };
    }
    cache = { at: Date.now(), value: map };
    return map;
  } catch {
    return cache?.value ?? {};
  }
}

/** Resolve one flag for a visitor, honouring its dependency chain. Unknown ⇒ false. */
export async function isEnabled(flagId: string, ctx: FlagContext): Promise<boolean> {
  const overrides = await getFlagOverrides();
  return resolveFlagWithDeps(flagId, getFlags(), overrides, ctx);
}

/** One declared flag, its current override, and how it resolves for `ctx`. */
export interface FlagState {
  flag: FeatureFlag;
  override: FlagOverride;
  /** Effective value for the given context, via the real resolver. */
  resolved: boolean;
}

/** Every declared flag with its override + resolved value — for the admin panel. */
export async function getFlagStates(ctx: FlagContext): Promise<FlagState[]> {
  const overrides = await getFlagOverrides();
  const flags = getFlags();
  return flags.map((flag) => {
    const override = overrides[flag.id] ?? {};
    return { flag, override, resolved: resolveFlagWithDeps(flag.id, flags, overrides, ctx) };
  });
}

/** Admin: persist one flag's override. `updatedBy` is the acting admin's id. */
export async function setFlagOverride(
  id: string,
  override: FlagOverride,
  updatedBy: string,
): Promise<void> {
  // Guard: only declared flags may be written, so the table can't accumulate
  // rows for ids nothing resolves (the admin equivalent of an orphan route).
  if (!getFlag(id)) throw new Error(`Unknown flag: ${id}`);
  const db = createAdminClient();

  // Capture the prior value for the audit trail (version history + rollback).
  const { data: prior } = await db.from("feature_flags").select("*").eq("id", id).maybeSingle();
  const p = prior as Record<string, unknown> | null;

  const full = {
    id,
    enabled: override.enabled ?? null,
    rollout_percentage: override.rolloutPercentage ?? null,
    active_from: override.activeFrom ?? null,
    active_until: override.activeUntil ?? null,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
  let { error } = await db.from("feature_flags").upsert(full, { onConflict: "id" });
  // If the schedule columns don't exist yet (0093 not applied), persist the rest —
  // scheduling silently no-ops until the migration lands; on/off/rollout still work.
  if (error && /active_from|active_until|column/i.test(error.message)) {
    const { active_from, active_until, ...base } = full;
    void active_from;
    void active_until;
    ({ error } = await db.from("feature_flags").upsert(base, { onConflict: "id" }));
  }
  if (error) throw new Error(error.message);

  recordConfigChange({
    actorId: updatedBy,
    surface: "flag",
    targetId: id,
    before: p
      ? { enabled: p.enabled, rolloutPercentage: p.rollout_percentage, activeFrom: p.active_from ?? null, activeUntil: p.active_until ?? null }
      : null,
    after: { enabled: full.enabled, rolloutPercentage: full.rollout_percentage, activeFrom: full.active_from, activeUntil: full.active_until },
  });
  cache = null;
}

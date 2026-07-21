import "server-only";

import { trackEvent } from "@/lib/analytics/events";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  assignVariant,
  type Assignment,
  type ExperimentContext,
  type ExperimentOverride,
  getExperiment,
} from "./experiments";

/**
 * Server-only read/write for experiment runtime state — the pause / forced-variant
 * OVERRIDES and the exposure counts. Mirrors `lib/platform/flags-store.ts`: the
 * registry + assignment in `./experiments` stay pure; the I/O is quarantined here
 * behind `import "server-only"`.
 *
 * Degrades to "no overrides" if the `experiments` table is absent (a lagging
 * migration just means every experiment runs exactly as declared), same contract
 * as the flag store.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

type OverrideMap = Record<string, ExperimentOverride>;

let cache: { at: number; value: OverrideMap } | null = null;
const TTL_MS = 10_000; // Short: a pause is a safety lever, same reasoning as flags.

/** All persisted overrides, keyed by experiment id. `{}` when unconfigured/error. */
export async function getExperimentOverrides(): Promise<OverrideMap> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (!hasSupabase) return {};
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("experiments")
      .select("id, paused, force_variant");
    if (error || !data) return cache?.value ?? {};
    const map: OverrideMap = {};
    for (const row of data) {
      map[row.id as string] = {
        paused: (row.paused as boolean | null) ?? null,
        forceVariant: (row.force_variant as string | null) ?? null,
      };
    }
    cache = { at: Date.now(), value: map };
    return map;
  } catch {
    return cache?.value ?? {};
  }
}

/** Assign a visitor to a variant of one experiment, honouring runtime overrides. */
export async function getAssignment(
  experimentId: string,
  ctx: ExperimentContext,
): Promise<Assignment> {
  const exp = getExperiment(experimentId);
  if (!exp) return { variant: "control", enrolled: false };
  const overrides = await getExperimentOverrides();
  return assignVariant(exp, ctx, overrides[experimentId]);
}

/**
 * Log one exposure. Call this ONLY for an enrolled assignment, at the point the
 * visitor actually experiences the variant — not on every render. Fire-and-forget
 * through the unified `events` pipeline; never throws, never blocks.
 */
export function trackExposure(
  experimentId: string,
  variant: string,
  userId?: string | null,
): void {
  trackEvent("experiment_exposure", { userId, metadata: { experiment: experimentId, variant } });
}

/**
 * Convenience: assign, and if enrolled, log the exposure in one call. Returns the
 * variant to render. The common path for a server component gating on a variant.
 */
export async function assignAndExpose(
  experimentId: string,
  ctx: ExperimentContext,
): Promise<string> {
  const a = await getAssignment(experimentId, ctx);
  if (a.enrolled) trackExposure(experimentId, a.variant, ctx.userId);
  return a.variant;
}

/** Exposure counts per experiment → per variant, for the admin panel. */
export type ExperimentStats = Record<string, Record<string, number>>;

export async function getExperimentStats(): Promise<ExperimentStats> {
  if (!hasSupabase) return {};
  try {
    const db = createAdminClient();
    // Aggregated server-side via an RPC (0092) rather than pulling every event row.
    const { data, error } = await db.rpc("experiment_exposure_counts");
    if (error || !data) return {};
    const stats: ExperimentStats = {};
    for (const row of data as { experiment: string; variant: string; exposures: number }[]) {
      if (!row.experiment) continue;
      (stats[row.experiment] ??= {})[row.variant ?? "unknown"] = Number(row.exposures);
    }
    return stats;
  } catch {
    return {};
  }
}

/** Admin: persist one experiment's override (pause / forced variant). */
export async function setExperimentOverride(
  id: string,
  override: ExperimentOverride,
  updatedBy: string,
): Promise<void> {
  const exp = getExperiment(id);
  if (!exp) throw new Error(`Unknown experiment: ${id}`);
  // A forced variant must name a real arm — refuse to persist a typo that would
  // silently send everyone to control.
  if (
    override.forceVariant != null &&
    override.forceVariant !== "" &&
    !exp.variants.some((v) => v.id === override.forceVariant)
  ) {
    throw new Error(`Unknown variant: ${override.forceVariant}`);
  }
  const db = createAdminClient();
  const { error } = await db.from("experiments").upsert(
    {
      id,
      paused: override.paused ?? null,
      force_variant: override.forceVariant || null,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
  cache = null;
}

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Runtime-config change history + audit trail. Every flag/experiment override write
 * records before → after here, giving version history, an accountability trail, and
 * the exact prior value to roll back to. The brief's "Runtime Governance".
 *
 * Best-effort: recording is fire-and-forget and NEVER blocks or fails the config
 * change it describes. Degrades to a no-op if the `config_audit_log` table is absent
 * (migration 0093 not yet applied), so the stores that call it stay safe.
 */

export type ConfigSurface = "flag" | "experiment";

export interface ConfigChange {
  id: string;
  actorId: string | null;
  surface: string;
  targetId: string;
  action: string;
  before: unknown;
  after: unknown;
  at: string;
}

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Record a config change. Fire-and-forget; never throws. */
export function recordConfigChange(input: {
  actorId: string | null;
  surface: ConfigSurface;
  targetId: string;
  action?: string;
  before: unknown;
  after: unknown;
}): void {
  if (!hasSupabase) return;
  void (async () => {
    try {
      const db = createAdminClient();
      await db.from("config_audit_log").insert({
        actor_id: input.actorId,
        surface: input.surface,
        target_id: input.targetId,
        action: input.action ?? "override.set",
        before: input.before ?? null,
        after: input.after ?? null,
      });
    } catch {
      /* audit is best-effort — must never break the change it records */
    }
  })();
}

/** Recent config changes, newest first — for the admin history view. `[]` on any error. */
export async function listConfigChanges(limit = 50): Promise<ConfigChange[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("config_audit_log")
      .select("id, actor_id, surface, target_id, action, before, after, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      actorId: (r.actor_id as string | null) ?? null,
      surface: r.surface as string,
      targetId: r.target_id as string,
      action: r.action as string,
      before: r.before ?? null,
      after: r.after ?? null,
      at: r.created_at as string,
    }));
  } catch {
    return [];
  }
}

import { createAdminClient } from "@/lib/supabase/admin";

/* Browser-safe constants, types and pure helpers live in ./time-capsules-shared.ts — a client
   component imports them from there, so this module (and its service-role
   queries) never reaches a browser bundle. Re-exported for server callers. */
import { type TimeCapsule } from "./time-capsules-shared";
export * from "./time-capsules-shared";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

interface TimeCapsuleRow {
  id: string;
  title: string;
  message: string;
  unlock_at: string;
  created_at: string;
}

/** Owner-only, soonest-unlocking first. Best-effort: a missing table
 *  (migration 0099 not yet applied) or any error yields an empty list rather
 *  than breaking the profile — same fail-closed convention as every other
 *  optional plane in this file's siblings. */
export async function getTimeCapsules(userId: string | null): Promise<TimeCapsule[]> {
  if (!userId || !hasSupabase) return [];
  try {
    const { data } = await createAdminClient()
      .from("time_capsules")
      .select("id, title, message, unlock_at, created_at")
      .eq("user_id", userId)
      .order("unlock_at", { ascending: true });
    const now = Date.now();
    return ((data ?? []) as TimeCapsuleRow[]).map((r) => {
      const locked = new Date(r.unlock_at).getTime() > now;
      return {
        id: r.id,
        title: r.title,
        message: locked ? null : r.message, // redacted at the source, not just in the UI
        unlockAt: r.unlock_at,
        createdAt: r.created_at,
        locked,
      };
    });
  } catch {
    return [];
  }
}

import { createAdminClient } from "@/lib/supabase/admin";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** A capsule seals for at least this long — a "capsule" that unlocks in two
 *  minutes isn't meaningfully sealed. Enforced on create, both here (for any
 *  future server-side caller) and in the API route. */
export const MIN_SEAL_MS = 60 * 60 * 1000; // 1 hour
export const TITLE_MAX = 80;
export const MESSAGE_MAX = 2000;

export interface TimeCapsule {
  id: string;
  title: string;
  /** Null while `locked` — the message NEVER reaches the client before
   *  `unlockAt`, regardless of how this is queried through the app. */
  message: string | null;
  unlockAt: string;
  createdAt: string;
  locked: boolean;
}

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

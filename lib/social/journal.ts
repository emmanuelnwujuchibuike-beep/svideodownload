import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
/** How many recent entries the profile rail shows — a private journal is not
 *  a feed to paginate on the profile itself; older entries still exist and
 *  are readable via the API, just not all loaded onto the page at once. */
export const JOURNAL_RAIL_LIMIT = 20;

export interface JournalEntry {
  id: string;
  content: string;
  mood: string | null;
  createdAt: string;
}

interface JournalEntryRow {
  id: string;
  content: string;
  mood: string | null;
  created_at: string;
}

/** Owner-only, newest first. Best-effort: a missing table (migration 0100
 *  not yet applied) or any error yields an empty list rather than breaking
 *  the profile. Never called for a visitor — a journal is always private. */
export async function getJournalEntries(userId: string | null, limit: number = JOURNAL_RAIL_LIMIT): Promise<JournalEntry[]> {
  if (!userId || !hasSupabase) return [];
  try {
    const { data } = await createAdminClient()
      .from("journal_entries")
      .select("id, content, mood, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data ?? []) as JournalEntryRow[]).map((r) => ({
      id: r.id,
      content: r.content,
      mood: r.mood,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

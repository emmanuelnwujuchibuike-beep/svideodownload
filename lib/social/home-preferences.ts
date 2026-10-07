import { createAdminClient } from "@/lib/supabase/admin";

import { isCategory, type Category } from "./categories";

/* Browser-safe constants, types and pure helpers live in ./home-preferences-shared.ts — a client
   component imports them from there, so this module (and its service-role
   queries) never reaches a browser bundle. Re-exported for server callers. */
import { type HomePreferences, DEFAULT_HOME_PREFERENCES, type HomePreferencesRow, fromHomePreferencesRow } from "./home-preferences-shared";
export * from "./home-preferences-shared";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Server-side read (SSR, and `home-feed.ts`'s ranking). Best-effort: a
 *  missing table (pre-migration) or any error just yields the defaults —
 *  the whole point of a "personalization" layer is that its absence should
 *  never break the feed, only leave it unpersonalized. */
export async function getHomePreferences(userId: string | null): Promise<HomePreferences> {
  if (!userId || !hasSupabase) return DEFAULT_HOME_PREFERENCES;
  try {
    const db = createAdminClient();
    const { data } = await db.from("user_home_preferences").select("*").eq("user_id", userId).maybeSingle();
    return fromHomePreferencesRow(data as HomePreferencesRow | null);
  } catch {
    return DEFAULT_HOME_PREFERENCES;
  }
}

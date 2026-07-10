import { createAdminClient } from "@/lib/supabase/admin";

import { isCategory, type Category } from "./categories";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** The optional Home sections a viewer can hide/reorder. The main feed is
 *  deliberately never a member — it's infinite, always renders last, and
 *  isn't something a "move it up/down" editor can meaningfully apply to. */
export const HOME_MODULE_KEYS = ["stories", "friend_activity", "trending_reels", "continue_watching"] as const;
export type HomeModuleKey = (typeof HOME_MODULE_KEYS)[number];

export function isHomeModuleKey(v: unknown): v is HomeModuleKey {
  return typeof v === "string" && (HOME_MODULE_KEYS as readonly string[]).includes(v);
}

export const HOME_MODULE_LABELS: Record<HomeModuleKey, string> = {
  stories: "Stories",
  friend_activity: "Friend Activity",
  trending_reels: "Trending Reels",
  continue_watching: "Continue Watching",
};

export interface HomePreferences {
  hiddenModules: HomeModuleKey[];
  /** Visible-or-not, ALL module keys in the viewer's chosen order — always a
   *  permutation of the full `HOME_MODULE_KEYS` set (see `normalizeOrder`). */
  moduleOrder: HomeModuleKey[];
  mutedCategories: Category[];
  boostedCategories: Category[];
  preferFriends: boolean;
  fewerReposts: boolean;
  quietMode: boolean;
}

export const DEFAULT_HOME_PREFERENCES: HomePreferences = {
  hiddenModules: [],
  moduleOrder: [...HOME_MODULE_KEYS],
  mutedCategories: [],
  boostedCategories: [],
  preferFriends: false,
  fewerReposts: false,
  quietMode: false,
};

/** A saved order might predate a newly-added module key, or have been
 *  corrupted client-side — always resolve to a full permutation so callers
 *  never have to think about a module key going missing. */
export function normalizeOrder(saved: unknown): HomeModuleKey[] {
  const known = Array.isArray(saved) ? saved.filter(isHomeModuleKey) : [];
  const seen = new Set(known);
  for (const k of HOME_MODULE_KEYS) if (!seen.has(k)) known.push(k);
  return known;
}

export interface HomePreferencesRow {
  hidden_modules: string[] | null;
  module_order: string[] | null;
  muted_categories: string[] | null;
  boosted_categories: string[] | null;
  prefer_friends: boolean | null;
  fewer_reposts: boolean | null;
  quiet_mode: boolean | null;
}

/** Pure row→camelCase mapper — shared by the server-side reader below and
 *  the `/api/home-preferences` route (which uses the session-scoped client,
 *  not the admin one, so it can't call `getHomePreferences` directly). */
export function fromHomePreferencesRow(row: HomePreferencesRow | null): HomePreferences {
  if (!row) return DEFAULT_HOME_PREFERENCES;
  return {
    hiddenModules: (row.hidden_modules ?? []).filter(isHomeModuleKey),
    moduleOrder: normalizeOrder(row.module_order),
    mutedCategories: (row.muted_categories ?? []).filter(isCategory),
    boostedCategories: (row.boosted_categories ?? []).filter(isCategory),
    preferFriends: !!row.prefer_friends,
    fewerReposts: !!row.fewer_reposts,
    quietMode: !!row.quiet_mode,
  };
}

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

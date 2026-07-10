import { NextResponse } from "next/server";
import { z } from "zod";

import { bustHomeFeedCache } from "@/lib/social/home-feed";
import { CATEGORIES } from "@/lib/social/categories";
import {
  fromHomePreferencesRow,
  HOME_MODULE_KEYS,
  normalizeOrder,
  type HomePreferencesRow,
} from "@/lib/social/home-preferences";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moduleKey = z.enum(HOME_MODULE_KEYS);
const category = z.enum(CATEGORIES);

const schema = z.object({
  hiddenModules: z.array(moduleKey).optional(),
  moduleOrder: z.array(moduleKey).optional(),
  mutedCategories: z.array(category).optional(),
  boostedCategories: z.array(category).optional(),
  preferFriends: z.boolean().optional(),
  fewerReposts: z.boolean().optional(),
  quietMode: z.boolean().optional(),
  // Surgical add/remove against whatever's ALREADY saved (see below) — for
  // the inline Home-page switches (Continue Watching / Friend Activity),
  // which only ever know about their own one module and must never clobber
  // a hide/show made elsewhere (a second tab, the Home Modules Editor) at
  // the same time the way sending a client-computed full `hiddenModules`
  // array would.
  hideModule: moduleKey.optional(),
  showModule: moduleKey.optional(),
});

/** GET /api/home-preferences — the signed-in viewer's Home/feed preferences. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data } = await supabase
    .from("user_home_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ preferences: fromHomePreferencesRow(data as HomePreferencesRow | null) });
}

/**
 * PATCH /api/home-preferences — partial update, merged with whatever's
 * already saved (fetch-then-upsert) so a caller can send just the one field
 * it changed (e.g. `{ quietMode: true }`) without needing to know or resend
 * the rest of the row — unlike `/api/privacy`, which is fine sending the
 * whole form every time since it's one single settings page; this route is
 * also called from small, focused UI (the "why am I seeing this" sheet)
 * that only ever knows about ONE field.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences." }, { status: 400 });

  const { data: existing } = await supabase
    .from("user_home_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const current = fromHomePreferencesRow(existing as HomePreferencesRow | null);
  // hideModule/showModule apply against `current.hiddenModules` — read fresh,
  // in THIS request — rather than trusting a client-sent full array (which
  // could be a stale snapshot racing a concurrent change elsewhere).
  let hiddenModules = parsed.data.hiddenModules ?? current.hiddenModules;
  if (parsed.data.hideModule && !hiddenModules.includes(parsed.data.hideModule)) {
    hiddenModules = [...hiddenModules, parsed.data.hideModule];
  }
  if (parsed.data.showModule) {
    hiddenModules = hiddenModules.filter((k) => k !== parsed.data.showModule);
  }
  // Re-normalize on the way IN too, not just on read: a duplicate key in a
  // malformed direct API call (the Reorder UI itself can never produce one)
  // would otherwise be upserted verbatim and render the same Home section
  // twice with the same React key until the next read happened to fix it up.
  const merged = {
    ...current,
    ...parsed.data,
    hiddenModules,
    moduleOrder: normalizeOrder(parsed.data.moduleOrder ?? current.moduleOrder),
  };

  const { error } = await supabase
    .from("user_home_preferences")
    .upsert(
      {
        user_id: user.id,
        hidden_modules: merged.hiddenModules,
        module_order: merged.moduleOrder,
        muted_categories: merged.mutedCategories,
        boosted_categories: merged.boostedCategories,
        prefer_friends: merged.preferFriends,
        fewer_reposts: merged.fewerReposts,
        quiet_mode: merged.quietMode,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) return NextResponse.json({ error: "Couldn't save preferences." }, { status: 500 });

  // Preferences feed straight into the NEXT "for_you" ranking (muted/boosted
  // categories, prefer-friends, fewer-reposts) — without this, a change could
  // sit behind the feed's own 20s cache, contradicting the "updates
  // immediately" promise this feature was built around.
  void bustHomeFeedCache(user.id);

  return NextResponse.json({ preferences: merged });
}

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Profile Layout Studio™ — the data layer (Feature 18 · Part 16, migration 0109).
 *
 * Fail-closed and independent, the pattern every profile reader here follows:
 * one query, its own try/catch, and a null result on any failure. Before 0109 is
 * applied this returns nulls and `resolveProfileTheme` renders the default
 * theme — so the feature is dormant, never broken.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface StoredProfileAppearance {
  theme: string | null;
  surface: string | null;
  radius: string | null;
  fontScale: string | null;
}

export const EMPTY_APPEARANCE: StoredProfileAppearance = {
  theme: null,
  surface: null,
  radius: null,
  fontScale: null,
};

export async function getProfileAppearance(profileId: string): Promise<StoredProfileAppearance> {
  if (!hasSupabase) return EMPTY_APPEARANCE;
  try {
    const { data, error } = await createAdminClient()
      .from("profile_appearance")
      .select("theme, surface, radius, font_scale")
      .eq("user_id", profileId)
      .maybeSingle();
    if (error || !data) return EMPTY_APPEARANCE;
    const r = data as { theme: string | null; surface: string | null; radius: string | null; font_scale: string | null };
    return {
      theme: r.theme || null,
      surface: r.surface || null,
      radius: r.radius || null,
      fontScale: r.font_scale || null,
    };
  } catch {
    return EMPTY_APPEARANCE;
  }
}

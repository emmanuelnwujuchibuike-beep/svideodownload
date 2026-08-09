import { NextResponse } from "next/server";
import { z } from "zod";

import { canEnableModule } from "@/lib/profile/engine";
import { layoutPreset } from "@/lib/profile/presets";
import {
  FONT_SCALE_KEYS,
  PROFILE_THEME_KEYS,
  RADIUS_KEYS,
  SURFACE_KEYS,
} from "@/lib/profile/theme";
import { captureVersion } from "@/lib/social/profile-versions";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Profile appearance (migration 0109) — theme, surface, radius, type scale.
 *
 * PATCH sets individual values. POST applies a whole Layout Preset, which is a
 * different operation: it writes appearance AND the profile type AND the module
 * layout, because a preset is only coherent if all three land together.
 *
 * Every enum comes from the registries in `lib/profile/theme.ts`, so a theme
 * that doesn't exist is rejected here rather than stored and silently ignored.
 */

const schema = z.object({
  theme: z.enum(PROFILE_THEME_KEYS).nullable().optional().or(z.literal("").transform(() => null)),
  surface: z.enum(SURFACE_KEYS).nullable().optional().or(z.literal("").transform(() => null)),
  radius: z.enum(RADIUS_KEYS).nullable().optional().or(z.literal("").transform(() => null)),
  font_scale: z.enum(FONT_SCALE_KEYS).nullable().optional().or(z.literal("").transform(() => null)),
});

const unavailable = () =>
  NextResponse.json(
    { error: "Profile themes aren't available yet. Ask an admin to apply the latest database update." },
    { status: 503 },
  );

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
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid appearance." }, { status: 400 });
  }

  const update: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(parsed.data)) if (value !== undefined) update[key] = value;
  if (Object.keys(update).length === 2) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await supabase.from("profile_appearance").upsert(update, { onConflict: "user_id" });
  if (error) return unavailable();
  // Journal the layout AFTER the member's change landed. Fire-and-forget:
  // failing to record history must never fail their save.
  void captureVersion(user.id);
  return NextResponse.json({ ok: true });
}

/**
 * Apply a Layout Preset.
 *
 * A preset is a starting point, so it writes ORDINARY values the member can
 * then change one by one — there is no "preset mode" to escape from afterwards.
 *
 * The three writes are deliberately independent rather than a transaction: the
 * profile type and modules live in the Part-14 tables and the appearance in
 * 0109, and any of those migrations may not be applied yet. A partial apply
 * leaves a coherent profile (the engine falls back for whatever is missing) and
 * is reported honestly, which is better than refusing to apply anything because
 * one table is behind.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: { preset?: string };
  try {
    body = (await request.json()) as { preset?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const preset = body.preset ? layoutPreset(body.preset) : undefined;
  if (!preset) return NextResponse.json({ error: "Unknown layout." }, { status: 400 });

  const failed: string[] = [];

  // 1) Profile type + landing section (Part 14 columns on `profiles`).
  {
    const { error } = await supabase
      .from("profiles")
      .update({ profile_type: preset.type, landing_module: preset.modules[0] })
      .eq("id", user.id);
    if (error) failed.push("profile type");
  }

  // 2) The module layout. Position comes from the ARRAY ORDER, and every module
  //    is re-checked against the preset's type — a preset can never enable
  //    something the type doesn't offer, whatever the registry says today.
  {
    const rows = preset.modules
      .filter((m) => canEnableModule(preset.type, m))
      .map((module_key, index) => ({
        user_id: user.id,
        module_key,
        enabled: true,
        position: index,
        audience: "public",
        updated_at: new Date().toISOString(),
      }));
    if (rows.length > 0) {
      const { error } = await supabase.from("profile_modules").upsert(rows, { onConflict: "user_id,module_key" });
      if (error) failed.push("sections");
    }
  }

  // 3) Appearance.
  {
    const { error } = await supabase.from("profile_appearance").upsert(
      {
        user_id: user.id,
        theme: preset.theme,
        surface: preset.surface,
        radius: preset.radius,
        font_scale: preset.fontScale,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) failed.push("theme");
  }

  if (failed.length === 3) return unavailable();
  void captureVersion(user.id);
  return NextResponse.json({ ok: true, applied: preset.key, ...(failed.length ? { partial: failed } : {}) });
}

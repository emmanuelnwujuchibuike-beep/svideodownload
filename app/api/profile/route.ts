import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizeHandle, PROFILE_ACCENT_KEYS, PROFILE_MOODS } from "@/lib/social/profile";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(300)
  .refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const schema = z.object({
  handle: z.string().trim().max(30).optional(),
  display_name: z.string().trim().max(40).nullable().optional().or(z.literal("").transform(() => null)),
  bio: z.string().trim().max(280).nullable().optional().or(z.literal("").transform(() => null)),
  avatar_url: httpUrl,
  banner_url: httpUrl,
  website: httpUrl,
  visibility: z.enum(["public", "followers", "private"]).optional(),
  // Status + mood (0095) and accent (0096) — saved separately, best-effort (below).
  status: z.string().trim().max(80).nullable().optional().or(z.literal("").transform(() => null)),
  mood: z.enum(PROFILE_MOODS).nullable().optional().or(z.literal("").transform(() => null)),
  accent: z.enum(PROFILE_ACCENT_KEYS).nullable().optional().or(z.literal("").transform(() => null)),
  // Digital Identity media (0098) — profile video, avatar image, chosen mode.
  profile_video_url: httpUrl,
  profile_avatar_url: httpUrl,
  identity_mode: z.enum(["photo", "video", "avatar"]).optional(),
});

/** PATCH /api/profile — update the signed-in user's social profile. */
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid profile." },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.handle !== undefined) {
    const norm = normalizeHandle(parsed.data.handle);
    if (!norm) {
      return NextResponse.json(
        { error: "Handle must be 3–20 letters/numbers/underscores and not reserved." },
        { status: 400 },
      );
    }
    update.handle = norm;
  }
  for (const k of ["display_name", "bio", "avatar_url", "banner_url", "website", "visibility"] as const) {
    if (parsed.data[k] !== undefined) update[k] = parsed.data[k];
  }

  // Status/mood (0095) and accent (0096) are written in SEPARATE, best-effort
  // updates so a not-yet-applied column for one can never fail the core profile
  // save (name/bio/etc.) — nor block the other extra.
  const statusMood: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) statusMood.status = parsed.data.status;
  if (parsed.data.mood !== undefined) statusMood.mood = parsed.data.mood;
  const accentUpdate: Record<string, unknown> = {};
  if (parsed.data.accent !== undefined) accentUpdate.accent = parsed.data.accent;
  // Digital Identity media (0098).
  const media: Record<string, unknown> = {};
  if (parsed.data.profile_video_url !== undefined) media.profile_video_url = parsed.data.profile_video_url;
  if (parsed.data.profile_avatar_url !== undefined) media.profile_avatar_url = parsed.data.profile_avatar_url;
  if (parsed.data.identity_mode !== undefined) media.identity_mode = parsed.data.identity_mode;

  if (
    Object.keys(update).length === 0 &&
    Object.keys(statusMood).length === 0 &&
    Object.keys(accentUpdate).length === 0 &&
    Object.keys(media).length === 0
  ) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "That handle is already taken." }, { status: 409 });
      }
      return NextResponse.json({ error: "Couldn't save profile." }, { status: 500 });
    }
  }

  // Best-effort: a missing column (before 0095/0096 apply) is swallowed so the
  // rest of the save still succeeds.
  if (Object.keys(statusMood).length > 0) await supabase.from("profiles").update(statusMood).eq("id", user.id);
  if (Object.keys(accentUpdate).length > 0) await supabase.from("profiles").update(accentUpdate).eq("id", user.id);
  if (Object.keys(media).length > 0) await supabase.from("profiles").update(media).eq("id", user.id);

  return NextResponse.json({ ok: true });
}

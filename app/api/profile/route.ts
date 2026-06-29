import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizeHandle } from "@/lib/social/profile";
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
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That handle is already taken." }, { status: 409 });
    }
    return NextResponse.json({ error: "Couldn't save profile." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

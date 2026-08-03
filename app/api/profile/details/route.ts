import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Profile details (migration 0107) — the singular fields behind the About,
 * Skills, Hours & location and Résumé modules.
 *
 * One row per member, upserted. Only the keys present in the request are
 * written, so the Business screen and the Professional screen can each save
 * their own half without clobbering the other's.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null));

const url = z
  .string()
  .trim()
  .max(300)
  .refine((u) => /^https?:\/\//i.test(u), "Links must start with http:// or https://")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const list = z.array(z.string().trim().min(1).max(40)).max(30).optional();

const hours = z
  .array(
    z.object({
      day: z.number().int().min(0).max(6),
      open: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
      close: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
      closed: z.boolean(),
    }),
  )
  .max(7)
  .optional();

const schema = z.object({
  headline: text(120),
  category: text(60),
  mission: text(1000),
  languages: list,
  availability: z.enum(["open", "selective", "unavailable"]).nullable().optional().or(z.literal("").transform(() => null)),
  skills: list,
  resume_url: url,
  founded: text(40),
  team_size: text(40),
  contact_email: z.string().trim().email().max(160).nullable().optional().or(z.literal("").transform(() => null)),
  contact_phone: text(40),
  booking_url: url,
  quote_url: url,
  address: text(200),
  city: text(80),
  country: text(80),
  hours,
});

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
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid details." }, { status: 400 });
  }

  const update: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) update[key] = value;
  }
  // `user_id` + `updated_at` are always present, so anything less means the
  // request carried no actual field.
  if (Object.keys(update).length === 2) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await supabase.from("profile_details").upsert(update, { onConflict: "user_id" });
  if (error) {
    return NextResponse.json(
      { error: "Profile details aren't available yet. Ask an admin to apply the latest database update." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}

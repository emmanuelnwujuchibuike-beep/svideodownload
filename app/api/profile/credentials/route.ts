import { NextResponse } from "next/server";
import { z } from "zod";

import { CREDENTIAL_KIND_KEYS } from "@/lib/social/profile-platform";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The professional showcase (migration 0107) — experience, education,
 * certifications, awards, publications and portfolio projects.
 *
 * One route for all six because they are one table with a `kind`: the shape is
 * identical (a title, an issuer, a date range, a link), and six near-identical
 * routes would be six places to forget an ownership check.
 *
 * Ownership is enforced twice: RLS restricts the row to its owner, AND every
 * write is scoped `.eq("user_id", user.id)`. Belt and braces — a policy that is
 * ever loosened by mistake must not turn into "anyone can edit any CV".
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
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), "Links must start with http:// or https://")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const fields = {
  title: z.string().trim().min(1, "A title is required.").max(140),
  organization: text(140),
  description: text(1000),
  url,
  image_url: url,
  started_on: text(40),
  ended_on: text(40),
  is_current: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
};

const createSchema = z.object({ kind: z.enum(CREDENTIAL_KIND_KEYS), ...fields });
const updateSchema = z.object({ id: z.string().uuid(), ...fields, title: fields.title.optional() });

/** 503 rather than 500 — this is "not deployed yet", not "broken". */
const unavailable = () =>
  NextResponse.json(
    { error: "The profile showcase isn't available yet. Ask an admin to apply the latest database update." },
    { status: 503 },
  );

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid entry." }, { status: 400 });
  }

  // A hard ceiling per member — a profile is a showcase, not a data dump, and
  // an unbounded list is an unbounded page for every visitor to download.
  const { count } = await supabase
    .from("profile_credentials")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id);
  if ((count ?? 0) >= 120) {
    return NextResponse.json({ error: "You've reached the limit of 120 entries." }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("profile_credentials")
    .insert({ ...parsed.data, user_id: user.id })
    .select("id")
    .maybeSingle();
  if (error) return unavailable();

  return NextResponse.json({ ok: true, id: (data as { id: string } | null)?.id ?? null });
}

export async function PATCH(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid entry." }, { status: 400 });
  }

  const { id, ...rest } = parsed.data;
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) if (value !== undefined) update[key] = value;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await supabase
    .from("profile_credentials")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return unavailable();

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { error } = await supabase.from("profile_credentials").delete().eq("id", id).eq("user_id", user.id);
  if (error) return unavailable();

  return NextResponse.json({ ok: true });
}

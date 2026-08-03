import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Products & services (migration 0107) — what the Business catalogue renders.
 *
 * Money is an INTEGER of minor units (kobo/cents). The client sends major
 * units as a string and this route converts once, here: a float would round
 * a price wrong somewhere between the form and the row, and there is no
 * acceptable rounding error on a price.
 *
 * `price_minor: null` means "contact for pricing" — a real answer for a
 * service, and never the same thing as free.
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

/** "12,500.50" → 1250050 minor units. Empty → null ("contact for pricing"). */
const price = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || (typeof v === "string" && v.trim() === "")) return null;
    const n = typeof v === "number" ? v : Number(v.replace(/[\s,]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: "Enter a valid price." });
      return z.NEVER;
    }
    // Round at the minor unit, not before — 19.99 must not become 1998.
    return Math.round(n * 100);
  });

const fields = {
  name: z.string().trim().min(1, "A name is required.").max(140),
  description: text(1000),
  price_minor: price,
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code.")
    .transform((c) => c.toUpperCase())
    .optional(),
  url,
  image_url: url,
  available: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
};

const createSchema = z.object({ kind: z.enum(["product", "service"]), ...fields });
const updateSchema = z.object({ id: z.string().uuid(), ...fields, name: fields.name.optional() });

const unavailable = () =>
  NextResponse.json(
    { error: "The catalogue isn't available yet. Ask an admin to apply the latest database update." },
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
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid item." }, { status: 400 });
  }

  const { count } = await supabase
    .from("profile_offerings")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id);
  if ((count ?? 0) >= 120) {
    return NextResponse.json({ error: "You've reached the limit of 120 items." }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("profile_offerings")
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
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid item." }, { status: 400 });
  }

  const { id, ...rest } = parsed.data;
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) if (value !== undefined) update[key] = value;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await supabase.from("profile_offerings").update(update).eq("id", id).eq("user_id", user.id);
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

  const { error } = await supabase.from("profile_offerings").delete().eq("id", id).eq("user_id", user.id);
  if (error) return unavailable();

  return NextResponse.json({ ok: true });
}

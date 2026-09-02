import { NextResponse } from "next/server";
import { z } from "zod";

import { createPlan, deletePlan, PLAN_KINDS, updatePlan } from "@/lib/creator/plan";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Content calendar plan entries (Feature 15 Part 9).
 * POST creates, PATCH edits, DELETE removes. Ownership is matched on every
 * statement inside `lib/creator/plan.ts` — RLS is the backstop, not the gate,
 * because these writes go through the service role.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).nullable().optional(),
  kind: z.enum(PLAN_KINDS),
  plannedFor: z.string().regex(DATE),
});

const patchSchema = z.object({
  id: z.string().regex(UUID),
  title: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  kind: z.enum(PLAN_KINDS).optional(),
  plannedFor: z.string().regex(DATE).optional(),
  status: z.enum(["planned", "done", "cancelled"]).optional(),
});

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Give it a title and a date." }, { status: 400 });

  const entry = await createPlan(user.id, parsed.data);
  return entry
    ? NextResponse.json({ ok: true, entry })
    : NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
}

export async function PATCH(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { id, ...patch } = parsed.data;
  const ok = await updatePlan(id, user.id, patch);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Couldn't save that." }, { status: 400 });
}

export async function DELETE(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const ok = await deletePlan(id, user.id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Couldn't delete." }, { status: 400 });
}

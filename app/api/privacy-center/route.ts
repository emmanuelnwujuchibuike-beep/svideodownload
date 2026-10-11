import { NextResponse } from "next/server";
import { z } from "zod";

import { applyPreset, endBoundary, privacyCenter, removeMeFromMemory, startBoundary } from "@/lib/privacy/center";
import { BOUNDARY_MODES, PRESETS } from "@/lib/privacy/relationship";
import { trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function me(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** GET — the signed-in member's Relationship Privacy Center: settings, counts, consents, temporary blocks and advice. */
export async function GET() {
  const id = await me();
  if (!id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return NextResponse.json(await privacyCenter(id), { headers: NO_STORE });
}

const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("preset"), key: z.enum(Object.keys(PRESETS) as [string, ...string[]]) }).strict(),
  z.object({ op: z.literal("boundary_start"), mode: z.enum(Object.keys(BOUNDARY_MODES) as [string, ...string[]]), hours: z.number().int().min(1).max(720).nullable() }).strict(),
  z.object({ op: z.literal("boundary_end") }).strict(),
  z.object({ op: z.literal("leave_memory"), memoryId: z.string().uuid() }).strict(),
]);

/** POST — presets, Boundary Modes and consent withdrawals, always for the session member only. */
export async function POST(req: Request) {
  const id = await me();
  if (!id) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`privacy-center:${id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many changes at once. Wait a moment." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const b = parsed.data;
  const out =
    b.op === "preset" ? await applyPreset(id, b.key)
    : b.op === "boundary_start" ? await startBoundary(id, b.mode, b.hours)
    : b.op === "boundary_end" ? await endBoundary(id)
    : await removeMeFromMemory(id, b.memoryId);
  return out.ok ? NextResponse.json(out, { headers: NO_STORE }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}

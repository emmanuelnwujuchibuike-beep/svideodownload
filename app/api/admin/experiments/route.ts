import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { getExperiments } from "@/lib/platform/experiments";
import {
  getExperimentOverrides,
  getExperimentStats,
  setExperimentOverride,
} from "@/lib/platform/experiments-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only: list experiments with overrides and live exposure counts. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [overrides, stats] = await Promise.all([getExperimentOverrides(), getExperimentStats()]);
  const experiments = getExperiments().map((e) => ({
    id: e.id,
    label: e.label,
    description: e.description,
    status: e.status,
    variants: e.variants,
    plans: e.plans ?? null,
    override: overrides[e.id] ?? { paused: null, forceVariant: null },
    exposures: stats[e.id] ?? {},
  }));
  return NextResponse.json({ experiments });
}

const schema = z.object({
  id: z.string().trim().min(1),
  paused: z.boolean().nullable().optional(),
  // "" clears the forced variant; a non-empty string must name a real arm (checked in the store).
  forceVariant: z.string().nullable().optional(),
});

/** Admin-only: persist one experiment's runtime override. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid experiment payload." }, { status: 400 });
  }

  try {
    await setExperimentOverride(
      parsed.data.id,
      { paused: parsed.data.paused ?? null, forceVariant: parsed.data.forceVariant ?? null },
      admin.id,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/Unknown experiment/.test(msg)) {
      return NextResponse.json({ error: "That experiment does not exist." }, { status: 400 });
    }
    if (/Unknown variant/.test(msg)) {
      return NextResponse.json({ error: "That variant is not part of this experiment." }, { status: 400 });
    }
    return NextResponse.json({ error: "Couldn't save the experiment." }, { status: 500 });
  }
}

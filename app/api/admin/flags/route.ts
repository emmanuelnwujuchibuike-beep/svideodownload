import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { getFlags } from "@/lib/platform/flags";
import { getFlagOverrides, setFlagOverride } from "@/lib/platform/flags-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only: list declared flags with their current overrides. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const overrides = await getFlagOverrides();
  const flags = getFlags().map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    category: f.category,
    defaultEnabled: f.defaultEnabled,
    rollout: f.rollout ?? null,
    plans: f.plans ?? null,
    adminBypass: !!f.adminBypass,
    requires: f.requires ?? null,
    consumer: f.consumer,
    override: overrides[f.id] ?? { enabled: null, rolloutPercentage: null, activeFrom: null, activeUntil: null },
  }));
  return NextResponse.json({ flags });
}

const isoOrNull = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const schema = z.object({
  id: z.string().trim().min(1),
  // Tri-state: true = force on, false = kill switch, null = defer to rollout/default.
  enabled: z.boolean().nullable().optional(),
  rolloutPercentage: z.number().int().min(0).max(100).nullable().optional(),
  // Scheduled activation / deactivation (ISO with offset), or null.
  activeFrom: isoOrNull,
  activeUntil: isoOrNull,
});

/** Admin-only: persist one flag's override. */
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
    return NextResponse.json({ error: "Invalid flag payload." }, { status: 400 });
  }

  try {
    await setFlagOverride(
      parsed.data.id,
      {
        enabled: parsed.data.enabled ?? null,
        rolloutPercentage: parsed.data.rolloutPercentage ?? null,
        activeFrom: parsed.data.activeFrom ?? null,
        activeUntil: parsed.data.activeUntil ?? null,
      },
      admin.id,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Unknown flag id (not in the code registry) lands here.
    const message = err instanceof Error && /Unknown flag/.test(err.message)
      ? "That flag does not exist."
      : "Couldn't save the flag.";
    const status = message === "That flag does not exist." ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

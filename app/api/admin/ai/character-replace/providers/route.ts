import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { listProviderHealth, resetProviderHealth } from "@/lib/ai/character-replace/circuit";
import { recordConfigChange } from "@/lib/platform/config-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin → AI → Character Replace → Providers (Part 8 §7, §21).
 *
 * GET lists every provider model's circuit state. POST closes one by hand —
 * "the provider is fine again, let jobs through now" — and writes who did
 * it and why to the config audit log. Operator only; nothing here is
 * reachable by a member, and the response names models the operator
 * configured themselves.
 */
const schema = z.object({ action: z.literal("close"), key: z.string().trim().min(1).max(160), reason: z.string().trim().min(3).max(300) }).strict();

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ providers: await listProviderHealth() });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const before = (await listProviderHealth()).find((p) => p.key === parsed.data.key) ?? null;
  const ok = await resetProviderHealth(parsed.data.key);
  recordConfigChange({
    actorId: admin.id,
    surface: "character_replace",
    targetId: `provider:${parsed.data.key}`,
    action: "circuit.close",
    before: before ? { failures: before.failures, openedUntil: before.openedUntil, openedCount: before.openedCount } : null,
    after: { failures: 0, openedUntil: null, _reason: parsed.data.reason },
  });
  console.info("[admin/cr/providers] circuit closed by hand", { admin: admin.id, key: parsed.data.key, ok });
  return NextResponse.json({ ok, detail: ok ? "Circuit closed — the next submit goes through." : "Nothing to close for that model." });
}

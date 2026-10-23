import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { getPaidVerificationConfig, setPaidVerificationConfig } from "@/lib/social/paid-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET / POST /api/admin/verification/paid-settings — the paid-verification switch, price and period (0268). Admin only. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ config: await getPaidVerificationConfig() }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const raw = await request.json().catch(() => null);
  try {
    // the normaliser clamps everything (a price outside the bounds switches it off) — see paid-verification-config.ts
    return NextResponse.json({ ok: true, config: await setPaidVerificationConfig(raw) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't save the settings." }, { status: 500 });
  }
}

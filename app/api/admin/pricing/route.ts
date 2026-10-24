import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSensitiveAdmin } from "@/lib/admin/reauth";
import { setPricing } from "@/lib/monetization/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tier = z.object({
  name: z.string().trim().min(1).max(40),
  price: z.string().trim().min(1).max(20),
  period: z.string().trim().max(10),
});
// the Nigeria 3-month bundles (2026-10-24): "" = off, else a plain dollar price — validated so the checkout can price it
const bundlePrice = z
  .string()
  .trim()
  .max(20)
  .regex(/^(|\$?\d{1,6}(\.\d{1,2})?)$/, "A 3-month bundle price is a dollar amount like $4.99 (or empty for off).");
const schema = z.object({ pro: tier, business: tier, ngQuarterly: z.object({ pro: bundlePrice, business: bundlePrice }).optional() });

/** Admin-only: update the displayed pricing shown on /pricing. */
export async function POST(request: Request) {
  /*
    SENSITIVE (requirement 10) — what every plan costs. A silent edit here
    changes what every subscriber is billed, so it needs a fresh password on top
    of the session. See lib/admin/reauth.ts.
  */
  const gate = await requireSensitiveAdmin();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.find((i) => i.path[0] === "ngQuarterly")?.message ?? "Fill in both plans' name, price and period." }, { status: 400 });
  }

  try {
    await setPricing(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save pricing." }, { status: 500 });
  }
}

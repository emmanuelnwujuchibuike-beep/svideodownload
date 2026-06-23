import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { setPricing } from "@/lib/monetization/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tier = z.object({
  name: z.string().trim().min(1).max(40),
  price: z.string().trim().min(1).max(20),
  period: z.string().trim().max(10),
});
const schema = z.object({ pro: tier, business: tier });

/** Admin-only: update the displayed pricing shown on /pricing. */
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
    return NextResponse.json({ error: "Fill in both plans' name, price and period." }, { status: 400 });
  }

  try {
    await setPricing(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save pricing." }, { status: 500 });
  }
}

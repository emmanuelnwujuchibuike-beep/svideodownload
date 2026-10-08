import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { bachsConfigured, readBachsProduct } from "@/lib/payments/bachs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ productId: z.string().trim().min(1).max(80) }).strict();

/**
 * POST /api/admin/ai/plans/verify-bachs — "Check with Bachs" on an AI plan
 * card (owner, 2026-10-07): what the product really is before it is saved —
 * its name, price, cycle, and whether it is RECURRING (a one-off product can
 * never be a subscription). Admin only; the key stays on the server.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!bachsConfigured()) return NextResponse.json({ ok: false, error: "Bachs is not configured on the server (BACHS_SECRET_KEY and BACHS_WEBHOOK_SECRET)." }, { status: 200 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a product id." }, { status: 400 });
  const id = parsed.data.productId;
  if (!/^prod_[A-Za-z0-9]{4,60}$/.test(id)) {
    return NextResponse.json({ ok: false, error: `"${id.slice(0, 24)}" is not a product id. A Bachs product id starts with prod_ (Bachs dashboard → Products → the plan). A payment link will not work.` }, { status: 200 });
  }
  try {
    return NextResponse.json({ ok: true, product: await readBachsProduct(id) });
  } catch (e) {
    const msg = String(e);
    const scope = /products:read|FORBIDDEN|403/.test(msg);
    const missing = /404/.test(msg);
    return NextResponse.json({ ok: false, error: scope ? "Bachs refused (403): the BACHS_SECRET_KEY on the server does not have the products:read permission. In the Bachs dashboard, open the API key, add products:read (checkouts also need payments:read and payments:write), or create a new key with them and update BACHS_SECRET_KEY on Vercel. The id can still be saved." : missing ? "Bachs does not know this product on the configured account (live vs sandbox?)." : "Bachs did not answer. Try again in a moment." }, { status: 200 });
  }
}

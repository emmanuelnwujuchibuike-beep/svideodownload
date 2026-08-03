import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { getPaystackConfig, setPaystackConfig } from "@/lib/paystack/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Show only a hint of the secret — never the full value — to the admin UI. */
function mask(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return "••••••";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/** GET — the current config for the admin form. The SECRET is never returned in
 *  full (masked + a "set" flag); the public key + plan codes are safe to show. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const c = await getPaystackConfig();
  return NextResponse.json({
    mode: c.mode,
    secretSet: !!c.secretKey,
    secretMasked: mask(c.secretKey),
    publicKey: c.publicKey,
    planPro: c.planPro,
    planBusiness: c.planBusiness,
  });
}

const schema = z.object({
  // Blank secret = keep the existing one (the form never re-sends it).
  secretKey: z.string().max(200).optional(),
  publicKey: z.string().max(200).optional(),
  planPro: z.string().max(100).optional(),
  planBusiness: z.string().max(100).optional(),
  mode: z.enum(["test", "live"]).optional(),
});

/** POST — save the config (admin only). */
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  try {
    await setPaystackConfig(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save the Paystack config." }, { status: 500 });
  }
}

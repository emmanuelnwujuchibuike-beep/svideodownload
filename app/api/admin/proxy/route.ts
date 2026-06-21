import { NextResponse } from "next/server";

import { getProxyUsage } from "@/server/proxy/proxy-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Residential-proxy usage + cost stats. Powers the admin dashboard widget.
 * Protected by WORKER_SECRET (the admin frontend forwards the same header), so
 * it's never public when a secret is configured.
 */
export async function GET(request: Request) {
  const secret = process.env.WORKER_SECRET;
  if (secret && request.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await getProxyUsage());
}

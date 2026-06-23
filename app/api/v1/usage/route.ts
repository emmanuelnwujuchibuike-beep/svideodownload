import { NextResponse } from "next/server";

import { authenticateApi } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /v1/usage — today's usage, daily limit and plan for the calling key. */
export async function GET(request: Request) {
  const auth = await authenticateApi(request);
  if (!auth.ok) return auth.response;
  const { plan, limit, used } = auth.ctx;
  return NextResponse.json({
    plan,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resets: "daily (UTC)",
  });
}

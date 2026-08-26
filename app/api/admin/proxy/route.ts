import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin/require-admin";
import { getProxyUsage } from "@/server/proxy/proxy-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Residential-proxy usage + cost stats. Powers the admin dashboard widget.
 * Protected by WORKER_SECRET (the admin frontend forwards the same header), so
 * it's never public when a secret is configured.
 */
export async function GET(request: Request) {
  /*
    🔴 THIS USED TO FAIL OPEN.

    It was:  if (secret && header !== secret) return 403;

    — so when `WORKER_SECRET` was unset OR an empty string, the condition
    short-circuited and the endpoint served proxy usage and cost data to
    ANYONE. "Present but empty" is not hypothetical here: this project has
    already had a production incident from exactly that shape (`CRON_SECRET=""`),
    and an empty env var is indistinguishable from an unset one to `&&`.

    Now it fails CLOSED, and accepts either of two callers:
      • the worker, presenting a NON-EMPTY shared secret; or
      • a signed-in administrator, which is how the dashboard widget reads it.
    No secret configured and not an admin ⇒ refused.
  */
  const secret = process.env.WORKER_SECRET?.trim();
  const fromWorker = !!secret && request.headers.get("x-worker-secret") === secret;

  if (!fromWorker) {
    const gate = await requireAdminApi();
    if (!gate.ok) return gate.response;
  }

  return NextResponse.json(await getProxyUsage());
}

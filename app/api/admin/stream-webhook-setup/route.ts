import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { configureStreamWebhook, hasStream } from "@/lib/media/stream";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/stream-webhook-setup — admin-only, one-time (or rotate-on-demand)
 * setup. Registers `${SITE_URL}/api/webhooks/stream` as the account's Stream
 * webhook so Cloudflare notifies us when a video finishes processing or errors
 * (see app/api/webhooks/stream). Cloudflare returns a signing secret — copy it
 * into `CF_STREAM_WEBHOOK_SECRET` (Vercel + .env.local) so the webhook route can
 * verify requests. The secret is only ever returned here, never stored by us.
 */
export async function POST() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  if (!hasStream) return NextResponse.json({ ok: false, skipped: "stream-disabled" });

  const notificationUrl = `${SITE_URL}/api/webhooks/stream`;
  const result = await configureStreamWebhook(notificationUrl);
  if (!result) return NextResponse.json({ ok: false, error: "Cloudflare rejected the webhook config." }, { status: 502 });

  return NextResponse.json({
    ok: true,
    notificationUrl,
    secret: result.secret,
    next: "Set CF_STREAM_WEBHOOK_SECRET to this secret in your environment, then redeploy.",
  });
}

import { advertiserRoute, str } from "@/lib/ads-platform/advertiser-route";
import { finalizeUpload } from "@/lib/ads-platform/advertiser-server";
import { adMessage } from "@/lib/ads-platform/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ads/advertiser/upload/finalize — the authoritative creative check.
 * Reads the uploaded object's REAL type, size, dimensions and duration (headers
 * only, by range), checks them against the CURRENT format row, then publishes
 * the creative or discards it. The browser's own numbers are never used.
 */
export function POST(request: Request) {
  return advertiserRoute(request, async ({ db, userId, body }) => {
    const r = await finalizeUpload(db, userId, str(body.creativeId, 64));
    const facts = { ...r.facts, ...r.limits };
    return { ...r, messages: r.errors.map((code) => adMessage(code, facts)) };
  });
}

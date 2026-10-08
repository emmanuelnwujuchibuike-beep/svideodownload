import { advertiserRoute, str } from "@/lib/ads-platform/advertiser-route";
import { uploadTicket } from "@/lib/ads-platform/advertiser-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ads/advertiser/upload — a signed PUT target for the creative (and
 * its poster, for a video) in the PRIVATE staging bucket. Moves no bytes: the
 * browser uploads straight to Supabase Storage. The declared type and size are
 * checked here only to refuse early — /finalize decides on the real bytes.
 */
export function POST(request: Request) {
  return advertiserRoute(request, ({ db, userId, body }) =>
    uploadTicket(db, userId, {
      campaignId: str(body.campaignId, 64),
      mediaType: str(body.mediaType, 16),
      mimeType: str(body.mimeType, 64),
      sizeBytes: typeof body.sizeBytes === "number" ? body.sizeBytes : -1,
    }),
  );
}

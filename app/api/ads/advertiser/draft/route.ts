import { advertiserRoute, str, strList } from "@/lib/ads-platform/advertiser-route";
import { discardDraft, saveDraft } from "@/lib/ads-platform/advertiser-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ads/advertiser/draft — save the application at a checkpoint
 * (entering the upload step, or "Save draft"). Never per keystroke: the form
 * lives in the browser between checkpoints. Format, placements and duration
 * are re-checked against the CURRENT admin catalog — a choice that stopped
 * being for sale is refused with a reason.
 */
export function POST(request: Request) {
  return advertiserRoute(request, ({ db, userId, body }) =>
    saveDraft(db, userId, {
      campaignId: str(body.campaignId, 64) || null,
      formatCode: str(body.formatCode, 64),
      placementCodes: strList(body.placementCodes),
      durationId: str(body.durationId, 64),
      name: str(body.name, 200),
      businessName: str(body.businessName, 200),
    }),
  );
}

/** DELETE /api/ads/advertiser/draft — discard an unpaid application (kept as cancelled). */
export function DELETE(request: Request) {
  return advertiserRoute(request, async ({ db, userId, body }) => {
    await discardDraft(db, userId, str(body.campaignId, 64));
    return { ok: true };
  });
}

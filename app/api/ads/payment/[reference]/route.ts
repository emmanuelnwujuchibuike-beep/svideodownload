import { advertiserRoute } from "@/lib/ads-platform/advertiser-route";
import { AdApplicationError } from "@/lib/ads-platform/advertiser-server";
import { adPaymentStatus } from "@/lib/ads-platform/payment-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ads/payment/[reference] — the advertiser's own payment, safely.
 *
 * Status, amounts, provider and the campaigns' live state. No secrets, no
 * provider payloads, nobody else's payment. While the payment is pending it
 * asks the PROVIDER once (our key), so a return that beat the webhook still
 * converges on the same settle - the return itself proves nothing.
 */
export function GET(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  return advertiserRoute(request, async ({ db, userId }) => {
    const { reference } = await params;
    const view = await adPaymentStatus(db, userId, decodeURIComponent(reference).slice(0, 120));
    if (!view) throw new AdApplicationError("payment_not_found", 404);
    return view;
  });
}

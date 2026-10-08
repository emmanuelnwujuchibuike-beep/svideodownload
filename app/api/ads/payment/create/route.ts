import { advertiserRoute, str } from "@/lib/ads-platform/advertiser-route";
import { AdApplicationError } from "@/lib/ads-platform/advertiser-server";
import { createAdCampaignPayment } from "@/lib/ads-platform/payment-server";
import { paymentMarket } from "@/lib/payments/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ads/payment/create { campaignId, quoteId }
 *
 * Opens (or hands back) the hosted checkout for an application. The amount
 * is the quote's, the provider is the router's, the market is the edge's
 * country header - the body names only WHICH campaign and WHICH quote.
 * Answers { url } to redirect to, or { verifying: reference } when a
 * provider's answer was uncertain (never a second checkout - see
 * lib/ads-platform/payment-server.ts).
 */
export function POST(request: Request) {
  return advertiserRoute(request, async ({ db, userId, email, body }) => {
    if (!email) throw new AdApplicationError("payment_not_started", 400);
    const r = await createAdCampaignPayment(db, {
      userId,
      email,
      campaignId: str(body.campaignId, 64),
      quoteId: str(body.quoteId, 64),
      market: paymentMarket(request.headers),
      preferredProvider: body.provider,
    });
    if (r.kind === "refused") throw new AdApplicationError(r.code, r.status);
    return r.kind === "redirect" ? { url: r.url, reference: r.reference } : { verifying: true, reference: r.reference };
  });
}

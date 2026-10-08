import { advertiserRoute, str } from "@/lib/ads-platform/advertiser-route";
import { submitApplication } from "@/lib/ads-platform/advertiser-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ads/advertiser/submit — "Continue to Payment". Requires the rules
 * checkbox (and the version the advertiser saw), checks the destination
 * (syntax + the admin blocklist — the URL is never fetched), requires a valid
 * creative, and LOCKS the price per campaign with the database's own quote.
 * The answer is the locked amount Part 3's checkout charges — never a number
 * the browser computed.
 */
export function POST(request: Request) {
  return advertiserRoute(request, ({ db, userId, body }) =>
    submitApplication(db, userId, {
      campaignId: str(body.campaignId, 64),
      name: str(body.name, 200),
      businessName: str(body.businessName, 200),
      headline: str(body.headline, 200),
      description: str(body.description, 400),
      destinationUrl: str(body.destinationUrl, 2048),
      rulesAccepted: body.rulesAccepted === true,
      rulesVersion: str(body.rulesVersion, 32),
    }),
  );
}

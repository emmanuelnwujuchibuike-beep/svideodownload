import { advertiserRoute, str } from "@/lib/ads-platform/advertiser-route";
import { AdApplicationError } from "@/lib/ads-platform/advertiser-server";
import { adMessage } from "@/lib/ads-platform/messages";
import { editDetails, extensionQuote, finalizeReplacement, replacementTicket, setPaused } from "@/lib/ads-platform/campaign-manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const version = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

/**
 * POST /api/ads/advertiser/manage — the advertiser's actions on a campaign
 * they already paid for (Part 6). One endpoint, one wrapper (session, rate
 * limit, plain-word refusals); every action re-checks ownership and state in
 * the database under a row lock. Reads never come here: the dashboard reads
 * Postgres directly under RLS.
 */
export function POST(request: Request) {
  return advertiserRoute(request, async ({ db, userId, body }) => {
    const campaignId = str(body.campaignId, 64);
    switch (str(body.action, 32)) {
      case "details":
        return editDetails(db, userId, { campaignId, expectedVersion: version(body.version), headline: body.headline, description: body.description, destinationUrl: body.destinationUrl });
      case "pause":
        return setPaused(db, userId, { campaignId, pause: true, expectedVersion: version(body.version) });
      case "resume":
        return setPaused(db, userId, { campaignId, pause: false, expectedVersion: version(body.version) });
      case "replace-ticket":
        return replacementTicket(db, userId, { campaignId, mediaType: str(body.mediaType, 16), mimeType: str(body.mimeType, 64), sizeBytes: Number(body.sizeBytes) || 0 });
      case "replace-finalize": {
        const r = await finalizeReplacement(db, userId, { creativeId: str(body.creativeId, 64), expectedVersion: version(body.version) });
        const facts = { ...r.facts, ...r.limits };
        return { ...r, messages: r.errors.map((code) => adMessage(code, facts)) };
      }
      case "extend-quote":
        return extensionQuote(db, userId, { campaignId, durationId: str(body.durationId, 64) });
      default:
        throw new AdApplicationError("bad_request", 400);
    }
  });
}

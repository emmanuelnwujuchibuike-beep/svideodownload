import { advertiserRoute, str } from "@/lib/ads-platform/advertiser-route";
import { adMessage } from "@/lib/ads-platform/messages";
import { advanceVideoProcessing } from "@/lib/ads-platform/media-processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/ads/advertiser/upload/status — where an oversized video's
 * transcode is (0208). Only the creative's own advertiser may ask. Asking also
 * moves it forward (media-processing.ts `advanceVideoProcessing`, idempotent),
 * so the advertiser watching the page sees "ready" as soon as Stream is done.
 * The browser polls this at a slow, bounded pace only while a video processes.
 */
export function POST(request: Request) {
  return advertiserRoute(request, async ({ db, userId, body }) => {
    const id = str(body.creativeId, 64);
    if (!UUID.test(id)) return { state: "failed", messages: [adMessage("not_found")] };
    const { data } = await db.from("ad_creatives").select("campaign_id").eq("id", id).maybeSingle();
    const { data: owner } = data
      ? await db.from("ad_campaigns").select("advertisers!inner(user_id)").eq("id", data.campaign_id).maybeSingle()
      : { data: null };
    const adv = (owner as { advertisers?: { user_id: string } | { user_id: string }[] } | null)?.advertisers;
    if ((Array.isArray(adv) ? adv[0]?.user_id : adv?.user_id) !== userId) return { state: "failed", messages: [adMessage("not_found")] };
    const s = await advanceVideoProcessing(db, id);
    return { ...s, messages: s.error ? [adMessage(s.error)] : [] };
  });
}

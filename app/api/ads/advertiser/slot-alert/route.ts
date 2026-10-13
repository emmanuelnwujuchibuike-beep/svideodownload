import { advertiserRoute, str } from "@/lib/ads-platform/advertiser-route";
import { AdApplicationError } from "@/lib/ads-platform/advertiser-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ads/advertiser/slot-alert { placementCode } — 0241 (owner
 * 2026-10-12): "tell me when a slot opens here". One open request per member
 * and placement (asking twice changes nothing). The hourly ad housekeeping
 * claims it once a slot is free and sends push AND email (notifySlotOpen).
 * Refused when the placement has room right now — there is nothing to wait for.
 */
export function POST(request: Request) {
  return advertiserRoute(request, async ({ db, userId, body }) => {
    const code = str(body.placementCode, 64);
    const { data: pl } = await db.from("ad_placements").select("id, enabled").eq("code", code).maybeSingle();
    if (!pl?.enabled) throw new AdApplicationError("placement_unavailable");
    const { data: avail, error: aErr } = await db.rpc("ad_slot_availability");
    if (aErr) throw new AdApplicationError("slot_alert_unavailable", 503);
    const row = ((avail as { placements?: { code: string; capacity: number; taken: number }[] } | null)?.placements ?? []).find((p) => p.code === code);
    if (row && row.taken < row.capacity) throw new AdApplicationError("slot_available", 409);
    const { error } = await db.from("ad_slot_waitlist").insert({ user_id: userId, placement_id: pl.id });
    // 23505: an open request already exists - the same answer
    if (error && error.code !== "23505") throw new Error(`ad_slot_waitlist: ${error.message}`);
    return { ok: true, placementCode: code };
  });
}

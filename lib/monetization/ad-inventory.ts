import { AD_ZONES } from "@/lib/monetization/ad-schema";
import type { AdInventory } from "@/lib/monetization/ad-inventory-shape";
import { resolveMonetagPlacements, resolveMonetagTags } from "@/lib/monetization/monetag";
import { getMonetizationSettings } from "@/lib/monetization/settings";
import {
  resolveGlobalScriptsForFreeVisitor,
  resolveSlotForFreeVisitor,
  resolveVastSource,
} from "@/lib/monetization/zone-resolution";

/**
 * Compute the inventory by running the SAME resolvers the real ad requests run
 * (lib/monetization/zone-resolution.ts), for a free visitor — the widest
 * audience, so a zone that could serve anyone is listed. A premium visitor
 * still gets `null` from the real endpoint; the inventory is a superset and
 * only ever decides whether ASKING is worthwhile.
 *
 * No second copy of the serving rules exists: if /api/ads would serve a zone,
 * this lists it, by construction.
 */
export async function computeAdInventory(): Promise<AdInventory> {
  const settings = await getMonetizationSettings();
  const zones = AD_ZONES.filter((z) => z !== "global");
  const [slotHits, vastHits, globals] = await Promise.all([
    Promise.all(zones.map(async (z) => ((await resolveSlotForFreeVisitor(z)) ? z : null))),
    Promise.all(zones.map(async (z) => ((await resolveVastSource(settings, z)) ? z : null))),
    resolveGlobalScriptsForFreeVisitor(),
  ]);
  return {
    v: 1,
    slots: slotHits.filter((z): z is (typeof zones)[number] => z !== null),
    vast: vastHits.filter((z): z is (typeof zones)[number] => z !== null),
    global: globals.some((a) => !!a.scriptCode),
    monetag: resolveMonetagTags(settings).length + resolveMonetagPlacements(settings).length > 0,
  };
}

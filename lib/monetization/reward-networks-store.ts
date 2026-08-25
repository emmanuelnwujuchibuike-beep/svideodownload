import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { offeriumConfigured } from "./offerium";
import {
  DEFAULT_REWARD_NETWORKS,
  mergeRewardNetworks,
  type NetworkCapabilities,
  type RewardNetworkMap,
} from "./reward-networks";
import { getMonetizationSettings } from "./settings";

/**
 * Storage + runtime capabilities for the reward-network routing table.
 *
 * ── Its own `settings` key, not a field on MonetizationSettings ───────────
 * `setMonetizationSettings` writes the WHOLE object from one admin form. A
 * `rewardNetworks` field living in there would be reset to its zod `.default()`
 * every time an operator saved the (much larger) Monetization panel, which does
 * not know about it — silently undoing the routing an admin had configured
 * elsewhere. A separate key makes that class of clobbering impossible, and
 * matches how `momentum` and `multi_link` already work.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let cache: { at: number; value: RewardNetworkMap } | null = null;

export async function getRewardNetworks(): Promise<RewardNetworkMap> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  if (!hasSupabase) return DEFAULT_REWARD_NETWORKS;
  try {
    const { data } = await createAdminClient()
      .from("settings")
      .select("value")
      .eq("key", "reward_networks")
      .maybeSingle();
    const merged = mergeRewardNetworks(data?.value);
    cache = { at: Date.now(), value: merged };
    return merged;
  } catch {
    return DEFAULT_REWARD_NETWORKS;
  }
}

export async function setRewardNetworks(map: RewardNetworkMap): Promise<void> {
  await createAdminClient()
    .from("settings")
    .upsert({ key: "reward_networks", value: map }, { onConflict: "key" });
  cache = null;
}

/**
 * The runtime facts `resolveRewardNetwork` needs but the table cannot know.
 *
 * Reads the monetization settings for Offerium's public config and
 * `offeriumConfigured` additionally checks the two server-only env secrets, so
 * this must stay server-side — which is why the resolved capabilities are sent
 * to the client through `/api/ads/config` as a plain boolean rather than the
 * client trying to work it out.
 */
export async function getNetworkCapabilities(): Promise<NetworkCapabilities> {
  try {
    const settings = await getMonetizationSettings();
    return { offeriumConfigured: offeriumConfigured(settings) };
  } catch {
    return { offeriumConfigured: false };
  }
}

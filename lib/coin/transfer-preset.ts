import "server-only";

import { lookupWallet } from "@/lib/ai/wallet/transfers";
import { metadataLimiter } from "@/lib/rate-limit";
import { isUuid } from "@/lib/sub/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export type TransferPreset = { number: string; name: string; handle: string | null; avatarUrl: string | null };

/**
 * `/wallet/transfer?to=<member id>` (a chat's "Send Frenz Coin") → the recipient, pre-chosen. Part 7 hardening:
 *   · READ-ONLY — the member's EXISTING wallet number is read; nothing is created during a page render (a member with no
 *     wallet number yet is simply not pre-chosen; the sender types the number as usual);
 *   · the SAME per-member rate limit as the number lookup (GET /api/ai/wallet/transfer/lookup, `wallet-lookup:<id>`),
 *     so this path can't be used to map member ids to wallet numbers faster than the lookup allows;
 *   · the name, handle and picture come from the same lookupWallet the endpoint uses (never an email); not yourself.
 * Anything unexpected → null (no preset). Nothing is sent from here — the transfer still needs review and the PIN.
 */
export async function resolveTransferPreset(viewerId: string, to: string | null | undefined): Promise<TransferPreset | null> {
  if (!to || !isUuid(to) || to === viewerId) return null;
  try {
    const burst = await metadataLimiter.limit(`wallet-lookup:${viewerId}`);
    if (!burst.success) return null;
    const { data, error } = await createAdminClient().from("wallet_accounts").select("account_number").eq("user_id", to).maybeSingle();
    const number = !error ? ((data as { account_number?: string } | null)?.account_number ?? null) : null;
    if (!number) return null;
    const who = await lookupWallet(number, viewerId);
    return who.ok ? { number, name: who.name, handle: who.handle, avatarUrl: who.avatarUrl } : null;
  } catch {
    return null;
  }
}

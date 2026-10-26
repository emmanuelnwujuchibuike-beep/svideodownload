import "server-only";

import { isUuid } from "@/lib/sub/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The people a member most recently sent Frenz Coin to (owner, 2026-10-26: Wallet setup — "save recipients").
 *
 * Read from the member's OWN transfer history (`transfer_out` ledger rows carry `recipient_id`), so there is no second
 * list to keep in step and nothing new to store: a recipient appears because they were paid. Tapping one opens
 * `/wallet/transfer?to=<id>`, the existing pre-fill (lib/coin/transfer-preset.ts), which resolves the wallet number on
 * the server under the lookup's own rate limit — the browser is never handed a wallet number from here.
 *
 * Public name, handle and picture only. A member who is suspended is not offered.
 */
export interface RecentRecipient {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

export async function recentCoinRecipients(userId: string, max = 5): Promise<RecentRecipient[]> {
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("ai_product_ledger")
      .select("metadata, created_at")
      .eq("user_id", userId)
      .eq("product", "frenz_coin")
      .eq("kind", "transfer_out")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return [];
    const ids: string[] = [];
    for (const r of (data ?? []) as { metadata: Record<string, unknown> | null }[]) {
      const id = r.metadata?.recipient_id;
      if (typeof id === "string" && isUuid(id) && id !== userId && !ids.includes(id)) ids.push(id);
      if (ids.length >= max) break;
    }
    if (ids.length === 0) return [];
    const { data: people } = await db.from("profiles").select("id, handle, display_name, avatar_url, is_suspended").in("id", ids);
    const byId = new Map(((people ?? []) as { id: string; handle: string | null; display_name: string | null; avatar_url: string | null; is_suspended?: boolean | null }[]).map((p) => [p.id, p]));
    return ids.flatMap((id) => {
      const p = byId.get(id);
      if (!p || p.is_suspended) return [];
      return [{ id, name: p.display_name || (p.handle ? `@${p.handle}` : "Frenz member"), handle: p.handle, avatarUrl: p.avatar_url }];
    });
  } catch {
    return [];
  }
}

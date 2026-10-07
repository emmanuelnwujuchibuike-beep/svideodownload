import "server-only";

import { after } from "next/server";

import { settleCharacterReplaceCharge, settleUnpaidTopup } from "@/lib/ai/wallet/paystack-settle";
import { CHARACTER_REPLACE_TOPUP_PURPOSE, paystackEnabled, verifyTransaction } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A DEPOSIT IS SETTLED EVEN WHEN THE MEMBER NEVER COMES BACK TO THE PAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: "I don't see deposited credit in Chris statement and they
 * are supposed to receive a push notification when their deposit was
 * successful or cancelled when they returned."
 *
 * Measured on production: @chris opened four Paystack checkouts that day and
 * every attempt row was still `pending` — no paid_at, no outcome, no
 * notification, no webhook event. The only code that ever moved a top-up out
 * of `pending` (other than a successful charge's webhook) was the
 * verify-on-return, and it needs the member to land back on the credits page
 * SIGNED IN. From an installed app that rarely happens: Paystack's return opens
 * in the system browser, which holds a different session from the home-screen
 * app (iOS keeps them apart), so the return verifies nothing, and a checkout
 * closed with the X never returns at all. The webhook covers a SUCCESS only —
 * Paystack sends nothing for a cancelled checkout.
 *
 * So the member's own recent pending top-ups are asked of Paystack directly
 * whenever they open their wallet:
 *   success   → credited through the same once-only path as the webhook, announced once
 *   failed    → recorded and announced once (push + email)
 *   abandoned → after 30 minutes (Paystack calls a checkout that is still open
 *               "abandoned" too), recorded as cancelled and announced once (push)
 *   pending   → left for next time
 *
 * On demand only — never a timer (the idle-cost law): one indexed read of the
 * member's own attempts, and a Paystack call only for a row that is pending.
 */
const MIN_AGE_MS = 60_000;
const CANCEL_AFTER_MS = 30 * 60_000;
const WINDOW_MS = 7 * 86_400_000;
const MAX_PER_PASS = 5;

export async function reconcileMemberTopups(userId: string): Promise<{ credited: number }> {
  const now = Date.now();
  const { data, error } = await createAdminClient()
    .from("ai_topup_attempts")
    .select("reference, created_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .eq("provider", "paystack")
    .like("reference", `${CHARACTER_REPLACE_TOPUP_PURPOSE}_%`)
    .gte("created_at", new Date(now - WINDOW_MS).toISOString())
    .lte("created_at", new Date(now - MIN_AGE_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_PER_PASS);
  const rows = (data ?? []) as { reference: string; created_at: string }[];
  if (error || !rows.length || !(await paystackEnabled())) return { credited: 0 };

  const outcomes = await Promise.all(
    rows.map(async (row) => {
      try {
        const charge = await verifyTransaction(row.reference);
        if (charge.metadata?.user_id !== userId) return 0;
        if (charge.status === "success") {
          const settled = await settleCharacterReplaceCharge(userId, row.reference, charge);
          if (settled.kind !== "credited") return 0;
          console.info("[ai/topup] reconciled a paid deposit", { userId, reference: row.reference, credits: settled.creditsAdded });
          after(settled.announce);
          return 1;
        }
        const old = now - Date.parse(row.created_at) >= CANCEL_AFTER_MS;
        if (charge.status === "failed" || (charge.status === "abandoned" && old)) {
          const outcome = charge.status;
          after(() =>
            settleUnpaidTopup({
              userId,
              reference: row.reference,
              outcome,
              amountCents: Number(charge.amount),
              currency: charge.currency ?? "",
              gatewayResponse: charge.gateway_response ?? null,
              channel: charge.channel ?? null,
            }),
          );
        }
        return 0;
      } catch (e) {
        // Paystack unreachable, or a reference it never saw — the row stays pending and is asked again next time
        console.warn("[ai/topup] reconcile check failed", { reference: row.reference, error: String(e).slice(0, 160) });
        return 0;
      }
    }),
  );
  return { credited: outcomes.reduce<number>((a, n) => a + n, 0) };
}

/** Bounded: the wallet answers within `ms` whatever Paystack does; a slow check finishes on the next open. */
export function reconcileMemberTopupsWithin(userId: string, ms = 4000): Promise<{ credited: number }> {
  return Promise.race([
    reconcileMemberTopups(userId).catch(() => ({ credited: 0 })),
    new Promise<{ credited: number }>((resolve) => setTimeout(() => resolve({ credited: 0 }), ms)),
  ]);
}

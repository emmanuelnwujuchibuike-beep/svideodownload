import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeAiWalletConfig, transferFee } from "@/lib/ai/credits/wallet-config";

/**
 * Owner, 2026-10-07: credits can be sent to another member's wallet number,
 * with a 5% charge, and the recipient's balance updates instantly. Pinned where
 * a regression would move credits twice, make them withdrawable, or let a
 * member pay less fee than the rate.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const m93 = code("supabase/migrations/0193_credit_transfers.sql");
const fn = (name: string) => {
  const start = m93.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return m93.slice(start, m93.indexOf("$$;", start));
};

describe("the fee", () => {
  it("5% by default, rounded UP — never a fraction, never below the rate", () => {
    expect(normalizeAiWalletConfig(null).transfers.feePercent).toBe(5);
    expect(transferFee(100, 5)).toBe(5);
    expect(transferFee(10, 5)).toBe(1); // 0.5 → 1
    expect(transferFee(101, 5)).toBe(6); // 5.05 → 6
    expect(transferFee(0, 5)).toBe(0);
    expect(transferFee(100, 0)).toBe(0);
  });
  it("the admin's numbers are clamped: fee 0–50 %, max ≥ min, daily ≥ max", () => {
    const t = normalizeAiWalletConfig({ transfers: { feePercent: 90, minCredits: 50, maxCredits: 10, dailyMaxCredits: 5 } }).transfers;
    expect(t.feePercent).toBe(50);
    expect(t.maxCredits).toBe(50);
    expect(t.dailyMaxCredits).toBe(50);
  });
});

describe("🔴 transfer_credits — one transaction, once, never withdrawable", () => {
  const t = fn("transfer_credits");
  it("the same idempotency key is the same transfer (checked first, and on the insert)", () => {
    expect(t).toContain("where sender_id = p_sender and idempotency_key = p_idempotency;");
    expect(t).toContain("on conflict (sender_id, idempotency_key) do nothing");
    expect(m93).toContain("create unique index if not exists credit_transfers_idem_idx on public.credit_transfers (sender_id, idempotency_key);");
  });
  it("both wallets locked in a fixed order (no deadlock), the balance checked against amount + fee", () => {
    expect(t).toContain("order by user_id for update;");
    expect(t).toContain("if v_s_bal < v_total then");
  });
  it("the sender spends non-withdrawable credits first; the recipient receives USABLE credits", () => {
    expect(t).toContain("v_wpart := greatest(0, v_total - (v_s_bal - v_s_wd));");
    expect(t).toMatch(/'transfer_in'[\s\S]*'usable', 0\);/);
    // teeth: the recipient's withdrawable balance is never touched
    const recipientUpdate = t.slice(t.indexOf("-- the recipient"), t.indexOf("return jsonb_build_object('ok', true, 'transfer_id'"));
    expect(recipientUpdate).not.toContain("withdrawable_cents");
  });
  it("no self-transfer, no restricted sender", () => {
    expect(t).toContain("if v_recipient = p_sender then return jsonb_build_object('ok', false, 'reason', 'self'); end if;");
    expect(t).toContain("where user_id = p_sender and restricted");
    expect(m93).toContain("constraint credit_transfers_self_chk check (sender_id <> recipient_id)");
  });
  it("a transfer can never farm the top-up referral reward (only 'recharge' rows raise it)", () => {
    expect(code("supabase/migrations/0187_rewards_referrals.sql")).toContain("if new.kind = 'recharge' then");
  });
  it("closed to the browser; the balance row joins realtime for the instant update", () => {
    expect(m93).toContain("'public.transfer_credits(uuid, text, integer, integer, text, text)'");
    expect(m93).toContain("alter publication supabase_realtime add table public.ai_product_balances");
  });
});

describe("the dashboard", () => {
  it("one idempotency key per transfer attempt — minted when the sheet opens, renewed only after success", () => {
    const p = code("features/ai/wallet/transfer-panel.tsx");
    expect(p).toContain("const key = useRef(newKey());");
    expect(p).toContain("idempotencyKey: key.current");
  });
  it("the credits page shows the panel and listens to its own wallet row only", () => {
    const u = code("features/ai/frenz-ai-usage-page.tsx");
    expect(u).toContain("<TransferPanel");
    expect(u).toContain("table: \"ai_product_balances\", filter: `user_id=eq.${uid}`");
    expect(u).toContain("if (channel) void supabase.removeChannel(channel);");
  });
  it("cache-first: re-entry paints the kept copy; history re-read only when the balance moved or it is old", () => {
    const p = code("features/ai/wallet/transfer-panel.tsx");
    expect(p).toContain("if (!k?.history || moved || Date.now() - (k?.at ?? 0) > HISTORY_STALE_MS) void loadHistory();");
  });
});

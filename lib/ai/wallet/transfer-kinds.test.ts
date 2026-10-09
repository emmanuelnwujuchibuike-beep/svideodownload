import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Credit kinds on transfer (0199, owner 2026-10-08; names 2026-10-09). The SQL
 * was executed in PGlite on the real 0193 + 0199 + 0202 (non-withdrawable stays
 * so for a qualified recipient, withdrawable arrives withdrawable, no borrowing
 * across kinds, idempotency with kind, one signature).
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const M = () => src("supabase/migrations/0199_credit_transfer_kinds.sql");

describe("the kind travels with the credits", () => {
  it("only the chosen kind pays, and the recipient gets the same kind", () => {
    const m = M();
    expect(m).toContain("v_avail := case when v_wd then v_s_wd else v_s_bal - v_s_wd end;");
    expect(m).toContain("withdrawable_cents = withdrawable_cents + case when v_wd then p_amount else 0 end,");
    expect(m).toContain("check (credit_class in ('usable', 'withdrawable'))");
    expect(m).toContain("drop function if exists public.transfer_credits(uuid, text, integer, integer, text, text);");
  });

  it("0202 keeps the same 7-argument signature and re-closes it to the browser", () => {
    const m = src("supabase/migrations/0202_deposited_credits.sql");
    expect(m).toContain("p_sender uuid, p_account_number text, p_amount integer, p_fee integer, p_idempotency text, p_note text, p_class text");
    expect(m).toContain("revoke all on function public.transfer_credits(uuid, text, integer, integer, text, text, text) from public, anon, authenticated");
  });

  it("the server passes the kind; both field names are accepted; the default is tokens", () => {
    expect(src("lib/ai/wallet/transfers.ts")).toContain("p_note: note, p_class: input.kind });");
    expect(src("app/api/ai/wallet/transfer/route.ts")).toContain('kind: parsed.data.kind ?? parsed.data.creditClass ?? "usable",');
  });

  it("the sender chooses between Tokens and Credits", () => {
    const p = src("features/ai/wallet/transfer-panel.tsx");
    expect(p).toContain("credits: n, kind, idempotencyKey: key.current");
    expect(p).toContain("usable: KIND_NAME.usable.title, withdrawable: KIND_NAME.withdrawable.title");
  });

  it("the split shows on the credits page and the rewards dashboard; the download/AI cards keep the total", () => {
    expect(src("features/ai/frenz-ai-usage-page.tsx")).toContain('<KindFigure kind="usable"');
    expect(src("features/rewards/rewards-page.tsx")).toContain('label="Tokens"');
    expect(src("features/ai/design/ai-credit-strip.tsx")).not.toMatch(/withdrawable/i);
  });

  it("teeth: a sheet that drops the kind fails the pin", () => {
    const p = src("features/ai/wallet/transfer-panel.tsx").replace("credits: n, kind, idempotencyKey", "credits: n, idempotencyKey");
    expect(p).not.toContain("credits: n, kind, idempotencyKey: key.current");
  });
});

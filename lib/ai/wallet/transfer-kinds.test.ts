import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Credit kinds on transfer (0199, owner 2026-10-08). The SQL was executed in
 * PGlite on the real 0193 + 0199: 18 checks (non-withdrawable stays so for a
 * qualified recipient, withdrawable arrives withdrawable, no borrowing across
 * kinds, idempotency with kind, restricted sender, grants, one signature).
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

  it("the server passes the kind; the default is non-withdrawable", () => {
    expect(src("lib/ai/wallet/transfers.ts")).toContain("p_idempotency: input.idempotencyKey, p_note: note, p_class: kind });");
    expect(src("app/api/ai/wallet/transfer/route.ts")).toContain('creditClass: parsed.data.creditClass ?? "usable",');
  });

  it("the sender chooses; the recipient is told which kind they got", () => {
    const p = src("features/ai/wallet/transfer-panel.tsx");
    expect(p).toContain('credits: n, idempotencyKey: key.current, note: note.trim() || null, creditClass: kind }),');
    expect(p).toContain('{t.kind === "withdrawable" ? "Withdrawable credits" : "Non-withdrawable credits"}');
    expect(src("lib/ai/wallet/transfers.ts")).toContain('const kindWord = kind === "withdrawable" ? "withdrawable credits" : "non-withdrawable credits";');
  });

  it("the split shows on the credits page and the rewards dashboard; the download/AI cards keep the total", () => {
    expect(src("features/ai/frenz-ai-usage-page.tsx")).toContain("withdrawable · <span");
    expect(src("features/rewards/rewards-page.tsx")).toContain('label="Non-withdrawable"');
    expect(src("features/ai/design/ai-credit-strip.tsx")).not.toMatch(/withdrawable/i);
  });
});

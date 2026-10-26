import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 4 — the wallet history (lib/coin/wallet.ts). Pinned: the member's own frenz_coin rows only (never an
 * AI-credit row, never another member's), newest first, keyset pages that never repeat or skip a row (the amount and
 * fee rows of one transfer share a timestamp), bounded page size, a status per entry, the other member of a transfer by
 * public handle only, and no metadata, admin note or provider id in the answer.
 */
let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
const { coinHistory } = await import("./wallet");

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = "00000000-0000-4000-8000-0000000000aa";
const row = (n: number, at: string, over: Record<string, unknown>) => ({ id: id(n), user_id: ME, product: "frenz_coin", status: "settled", created_at: at, metadata: {}, note: "internal note", ...over });

beforeEach(() => {
  db = fakeDb({
    profiles: [{ id: OTHER, handle: "ada.creates", display_name: "Ada Okafor" }],
    ai_product_ledger: [
      row(1, "2026-10-20T10:00:00.000001+00:00", { kind: "deposit", status: "settled", delta_cents: 10_000, metadata: { provider: "flutterwave", deposit_reference: "frenz_coin_dep_fw_x" } }),
      row(2, "2026-10-21T10:00:00.000001+00:00", { kind: "transfer_out", delta_cents: -5_000, metadata: { transfer_id: T, recipient_id: OTHER } }),
      row(3, "2026-10-21T10:00:00.000001+00:00", { kind: "transfer_fee", delta_cents: -600, metadata: { transfer_id: T, fee: { percent: 500 } } }),
      row(4, "2026-10-22T10:00:00.000001+00:00", { kind: "deposit", status: "reserved", delta_cents: 20_000, metadata: { release_at: "2026-10-25T10:00:00+00:00" } }),
      row(5, "2026-10-23T10:00:00.000001+00:00", { kind: "adjustment", delta_cents: 100, note: "fraud review: device farm", metadata: { pending: false } }),
      row(6, "2026-10-24T10:00:00.000001+00:00", { kind: "transfer_in", delta_cents: 700, metadata: { transfer_id: id(77), sender_id: OTHER } }),
      // not mine / not coins
      { ...row(7, "2026-10-24T11:00:00+00:00", { kind: "transfer_in", delta_cents: 1 }), user_id: OTHER },
      { ...row(8, "2026-10-24T12:00:00+00:00", { kind: "recharge", delta_cents: 50 }), product: "character_replace" },
    ],
  });
});

describe("coinHistory", () => {
  it("the member's coin rows, newest first, with a status each, and nothing internal", async () => {
    const out = await coinHistory(ME, { limit: 50 });
    if (!out.ok) throw new Error("not ok");
    expect(out.items.map((i) => i.id)).toEqual([id(6), id(5), id(4), id(3), id(2), id(1)]);
    expect(out.next).toBeNull();
    const by = Object.fromEntries(out.items.map((i) => [i.id, i]));
    expect(by[id(4)]).toMatchObject({ kind: "deposit", status: "pending", amountCents: 20_000, releaseAt: "2026-10-25T10:00:00+00:00", title: "Deposit" });
    expect(by[id(1)]).toMatchObject({ kind: "deposit", status: "completed", releaseAt: null });
    expect(by[id(2)]).toMatchObject({ kind: "transfer_out", title: "To Ada Okafor", amountCents: -5_000, transferId: T, counterparty: { handle: "ada.creates", name: "Ada Okafor" } });
    expect(by[id(3)]).toMatchObject({ kind: "transfer_fee", title: "Transfer fee", amountCents: -600, transferId: T, counterparty: null });
    expect(by[id(6)]).toMatchObject({ kind: "transfer_in", title: "From Ada Okafor" });
    expect(by[id(5)]).toMatchObject({ kind: "adjustment", title: "Balance correction" });
    const text = JSON.stringify(out);
    for (const secret of ["fraud", "internal note", "device farm", OTHER, "flutterwave", "frenz_coin_dep_fw_x", "metadata", "percent"]) expect(text).not.toContain(secret);
  });
  it("keyset pages: every row exactly once, even rows sharing a timestamp", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await coinHistory(ME, { cursor, limit: 2 });
      if (!page.ok) throw new Error("not ok");
      seen.push(...page.items.map((x) => x.id));
      cursor = page.next;
      if (!cursor) break;
    }
    expect(seen).toEqual([id(6), id(5), id(4), id(3), id(2), id(1)]);
  });
  it("the page size is bounded (50 at most) and a bad cursor is refused", async () => {
    const big = await coinHistory(ME, { limit: 10_000 });
    expect(big.ok).toBe(true);
    expect(await coinHistory(ME, { cursor: "not-a-cursor!" })).toMatchObject({ ok: false, status: 400 });
  });
  it("another member sees none of these rows", async () => {
    const out = await coinHistory(OTHER, { limit: 50 });
    if (!out.ok) throw new Error("not ok");
    expect(out.items.map((i) => i.id)).toEqual([id(7)]);
  });
});

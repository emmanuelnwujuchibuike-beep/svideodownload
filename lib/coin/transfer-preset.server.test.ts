import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 7 regression — `/wallet/transfer?to=<member id>`. The defect: the page resolved ANY member id to
 * their wallet number and name with no rate limit (bypassing the number lookup's anti-enumeration limit), and called
 * ensure_wallet_number — a write during a page render. Pinned: read-only (no write, no RPC), the lookup's own
 * per-member limit applies, and anything odd (self, not a uuid, no wallet number, limited) is simply no preset.
 */
let db: FakeDb;
let allowed = true;
const limit = vi.fn(async (_key: string) => ({ success: allowed }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/rate-limit", () => ({ metadataLimiter: { limit: (k: string) => limit(k) } }));

const { resolveTransferPreset } = await import("./transfer-preset");
const ME = "11111111-1111-4111-8111-111111111111";
const ADA = "22222222-2222-4222-8222-222222222222";
const NEW = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  db = fakeDb({
    wallet_accounts: [{ user_id: ADA, account_number: "1203682058" }, { user_id: ME, account_number: "1209999999" }],
    profiles: [{ id: ADA, handle: "ada", display_name: "Ada Obi", avatar_url: null, email: "ada@example.com" }],
  });
  db.rpc.ensure_wallet_number = vi.fn(() => ({ data: "1200000000", error: null }));
  allowed = true;
  limit.mockClear();
});

describe("resolveTransferPreset", () => {
  it("resolves an existing wallet number and public name — never an email", async () => {
    const p = await resolveTransferPreset(ME, ADA);
    expect(p).toEqual({ number: "1203682058", name: "Ada Obi", handle: "ada", avatarUrl: null });
    expect(JSON.stringify(p)).not.toContain("@example.com");
  });
  it("is READ-ONLY: no write and no ensure_wallet_number, even for a member without a number", async () => {
    expect(await resolveTransferPreset(ME, NEW)).toBeNull();
    expect(db.rpc.ensure_wallet_number).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });
  it("uses the number lookup's own per-member limit, and gives nothing once it is reached", async () => {
    await resolveTransferPreset(ME, ADA);
    expect(limit).toHaveBeenCalledWith(`wallet-lookup:${ME}`);
    allowed = false;
    expect(await resolveTransferPreset(ME, ADA)).toBeNull();
  });
  it("yourself, a non-uuid or nothing → no preset (and no limiter spent)", async () => {
    expect(await resolveTransferPreset(ME, ME)).toBeNull();
    expect(await resolveTransferPreset(ME, "not-a-uuid")).toBeNull();
    expect(await resolveTransferPreset(ME, null)).toBeNull();
    expect(limit).not.toHaveBeenCalled();
  });
});

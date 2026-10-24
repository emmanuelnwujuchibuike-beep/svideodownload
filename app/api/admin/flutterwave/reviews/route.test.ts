import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Part 3.3 — the admin review queue route: admins only; changing anything needs the fresh-password gate; "apply" goes
 * through applyReviewedRenewal (re-verify + the one ledger), the rest only closes an open review.
 */
let isAdmin = true;
let sensitiveOk = true;
const applied: string[] = [];
const closed: { id: string; status: string }[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/require-admin", () => ({ getAdminUser: async () => (isAdmin ? { id: "admin-1" } : null) }));
vi.mock("@/lib/admin/reauth", () => ({
  requireSensitiveAdmin: async () => (sensitiveOk ? { ok: true } : { ok: false, response: new Response(JSON.stringify({ error: "reauth" }), { status: 401 }) }),
}));
vi.mock("@/lib/ai/credits/flutterwave-plans", () => ({
  listBillingReviews: async (status: string) => [{ id: "r1", kind: "renewal", status: status === "open" ? "open" : "applied" }],
  applyReviewedRenewal: async (id: string) => (applied.push(id), { ok: true, result: "applied" }),
  closeBillingReview: async (id: string, _admin: string, status: string) => (closed.push({ id, status }), true),
}));

const { GET, POST } = await import("./route");
const ID = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown) => POST(new Request("https://frenzsave.com/api/admin/flutterwave/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  isAdmin = true;
  sensitiveOk = true;
  applied.length = 0;
  closed.length = 0;
});

describe("admin: plan billing reviews", () => {
  it("admins only — a member gets 403", async () => {
    isAdmin = false;
    expect((await GET(new Request("https://frenzsave.com/api/admin/flutterwave/reviews"))).status).toBe(403);
  });

  it("lists open reviews (or closed ones), and says whether Flutterwave can prove renewal ownership yet", async () => {
    delete process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP;
    expect(await (await GET(new Request("https://frenzsave.com/api/admin/flutterwave/reviews"))).json()).toEqual({ reviews: [{ id: "r1", kind: "renewal", status: "open" }], renewalProofAvailable: false });
    expect(await (await GET(new Request("https://frenzsave.com/api/admin/flutterwave/reviews?status=closed"))).json()).toEqual({ reviews: [{ id: "r1", kind: "renewal", status: "applied" }], renewalProofAvailable: false });
    process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP = "confirmed";
    expect(await (await GET(new Request("https://frenzsave.com/api/admin/flutterwave/reviews"))).json()).toMatchObject({ renewalProofAvailable: true });
    delete process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP;
  });

  it("changing anything needs the fresh password — nothing applied without it", async () => {
    sensitiveOk = false;
    expect((await post({ id: ID, action: "apply" })).status).toBe(401);
    expect(applied).toEqual([]);
  });

  it("apply → the one renewal path; resolve / dismiss → closed; anything else refused", async () => {
    expect(await (await post({ id: ID, action: "apply" })).json()).toEqual({ ok: true, result: "applied" });
    expect(applied).toEqual([ID]);
    expect((await post({ id: ID, action: "dismiss", note: "duplicate charge refunded" })).status).toBe(200);
    expect(closed).toEqual([{ id: ID, status: "dismissed" }]);
    expect((await post({ id: ID, action: "extend_free" })).status).toBe(400);
    expect((await post({ id: "not-a-uuid", action: "apply" })).status).toBe(400);
  });
});

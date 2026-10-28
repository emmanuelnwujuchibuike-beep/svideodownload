import { beforeEach, describe, expect, it, vi } from "vitest";

import { dayLabel, groupByDay, type GiftBoxItem } from "@/features/gift/gift-box";
import { giftLine } from "@/features/gift/gift-bubble";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Gift Coin Part 5: the Gift Box (history) and the chat bubble's wording. Pins: the history is the member's OWN
 * gifts only, from each gift's stored snapshot (a later sticker change is not shown), received rows show the share
 * earned and its hold, sent rows the price; keyset paging; the conversion preview rules endpoint needs a session; and
 * in a group only the chosen recipient reads "sent you a gift".
 */
let db: FakeDb;
let sessionUser: { id: string } | null = null;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));

const history = await import("@/app/api/gift/history/route");
const convert = await import("@/app/api/gift/convert/route");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const CONV = "00000000-0000-4000-8000-0000000000c1";
const gift = (i: number, sender: string, recipient: string, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
  sender_id: sender,
  recipient_id: recipient,
  conversation_id: CONV,
  price_fgc: 5000,
  recipient_share: 4500,
  status: "pending",
  hold_until: "2026-10-30T10:00:00.000Z",
  sticker_snapshot: { name: "Red Rose", image_url: "https://cdn.example.test/rose-v1.webp", rarity: "rare" },
  created_at: `2026-10-27T10:${String(i).padStart(2, "0")}:00.000Z`,
  ...over,
});
const get = (q: string) => history.GET(new Request(`https://frenzsave.com/api/gift/history?${q}`));

beforeEach(() => {
  db = fakeDb({
    gift_sends: [gift(1, A, B), gift(2, A, B, { status: "released" }), gift(3, C, A), gift(4, A, C, { status: "reversed" })],
    profiles: [{ id: A, display_name: "Ada", handle: "ada" }, { id: B, display_name: "Bo", handle: "bo" }, { id: C, display_name: "Chi", handle: "chi" }],
    // the sticker as it is NOW — re-priced and renamed: the history must not show it
    gift_stickers: [{ id: "s1", name: "Renamed", price_fgc: 9900, image_url: "https://cdn.example.test/rose-v2.webp" }],
    settings: [],
  });
  sessionUser = { id: B };
});

describe("GET /api/gift/history", () => {
  it("needs a session and a box", async () => {
    sessionUser = null;
    expect((await get("box=received")).status).toBe(401);
    sessionUser = { id: B };
    expect((await get("box=everything")).status).toBe(400);
  });
  it("received: only the member's own gifts, newest first, the share earned, the hold, the sender by public name", async () => {
    const body = await (await get("box=received")).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([gift(2, A, B).id, gift(1, A, B).id]);
    expect(body.items[1]).toMatchObject({ amountFgc: 4500, status: "pending", holdUntil: "2026-10-30T10:00:00.000Z", other: { name: "Ada", handle: "ada" } });
    expect(body.items[0]).toMatchObject({ status: "released", holdUntil: null });
    expect(body.counts).toEqual({ received: 2, sent: 0 });
  });
  it("uses each gift's STORED snapshot, not the sticker's current name, price or artwork", async () => {
    const body = await (await get("box=received")).json();
    expect(body.items[0].sticker).toEqual({ name: "Red Rose", imageUrl: "https://cdn.example.test/rose-v1.webp", rarity: "rare" });
    expect(JSON.stringify(body)).not.toMatch(/Renamed|9900|rose-v2/);
  });
  it("sent: the price paid, the recipient, a reversed gift marked reversed", async () => {
    sessionUser = { id: A };
    const body = await (await get("box=sent")).json();
    expect(body.items).toHaveLength(3);
    expect(body.items[0]).toMatchObject({ amountFgc: 5000, status: "reversed", other: { name: "Chi" } });
    expect(body.items.every((i: { holdUntil: string | null }) => i.holdUntil === null)).toBe(true);
  });
  it("pages with a cursor and never repeats a row", async () => {
    sessionUser = { id: A };
    const first = await (await get("box=sent&limit=2")).json();
    expect(first.items).toHaveLength(2);
    expect(first.next).toBeTruthy();
    const second = await (await get(`box=sent&limit=2&cursor=${encodeURIComponent(first.next)}`)).json();
    expect(second.items).toHaveLength(1);
    expect(second.next).toBeNull();
    const ids = [...first.items, ...second.items].map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(3);
  });
  it("Part 6: the note is kept in history on the batch's first gift only, with each gift's place in its send", async () => {
    db.tables.gift_sends = [
      gift(5, A, B, { batch_id: "b1", batch_index: 1, batch_size: 2, note: "<b>for you</b>" }),
      gift(6, A, B, { batch_id: "b1", batch_index: 2, batch_size: 2, note: null }),
    ];
    const body = await (await get("box=received")).json();
    const byId = new Map(body.items.map((i: { id: string }) => [i.id, i]));
    expect(byId.get(gift(5, A, B).id)).toMatchObject({ note: "<b>for you</b>", batch: { index: 1, size: 2 } });
    expect(byId.get(gift(6, A, B).id)).toMatchObject({ note: null, batch: { index: 2, size: 2 } });
    // a gift sent alone before 0296: 1 of 1, no note
    db.tables.gift_sends = [gift(7, A, B)];
    expect((await (await get("box=received")).json()).items[0]).toMatchObject({ note: null, batch: { index: 1, size: 1 } });
  });
  it("a bad cursor is refused", async () => {
    expect((await get("box=sent&cursor=not-a-cursor")).status).toBe(400);
  });
});

describe("GET /api/gift/convert (the preview's rules)", () => {
  it("needs a session; says 'not configured' until the admin saves rules", async () => {
    sessionUser = null;
    expect((await convert.GET()).status).toBe(401);
    sessionUser = { id: B };
    expect(await (await convert.GET()).json()).toEqual({ configured: false, rules: null });
  });
  it("returns the saved rules and their version (sent back as expectedVersion)", async () => {
    const rules = { version: 3, fcToFgc: { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 }, fgcToFc: { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 } };
    db.tables.settings = [{ key: "landing", value: { frenzGift: { conversion: rules } } }];
    expect(await (await convert.GET()).json()).toEqual({ configured: true, rules });
  });
});

describe("the gift bubble's line", () => {
  it("the sender, the chosen recipient, and everyone else in a group each read the right thing", () => {
    expect(giftLine({ name: "Rose" }, true, false, "Ada", "Bo")).toBe("You sent Bo a gift");
    expect(giftLine({ name: "Rose" }, false, true, "Ada", "Bo")).toBe("Ada sent you a gift");
    expect(giftLine({ name: "Rose" }, false, false, "Ada", "Bo")).toBe("Ada sent Bo a gift");
    expect(giftLine({}, false, true, "Ada", "Bo")).toBe("Sent a gift");
  });
});

describe("the Gift Box's day groups (design: TODAY / THIS WEEK style heads)", () => {
  const now = new Date("2026-10-27T15:00:00");
  const item = (at: string): GiftBoxItem => ({ id: at, at, conversationId: CONV, sticker: { name: "x", imageUrl: null, rarity: "common" }, amountFgc: 1, status: "released", holdUntil: null, other: null });
  it("labels today and yesterday, then dates", () => {
    expect(dayLabel("2026-10-27T09:00:00", now)).toBe("TODAY");
    expect(dayLabel("2026-10-26T23:00:00", now)).toBe("YESTERDAY");
    expect(dayLabel("2026-10-12T09:00:00", now)).toBe("12 OCT");
  });
  it("groups consecutive rows by day, in order", () => {
    const g = groupByDay([item("2026-10-27T12:00:00"), item("2026-10-27T09:00:00"), item("2026-10-25T09:00:00")], now);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([["TODAY", 2], ["25 OCT", 1]]);
  });
});

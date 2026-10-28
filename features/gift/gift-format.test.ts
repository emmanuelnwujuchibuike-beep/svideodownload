import { describe, expect, it } from "vitest";

import { formFromGifting, readGiftingForm } from "@/features/admin/frenz-gift/gift-admin-logic";

import { categoriesOf, fgcText, giftFailureText, giftKey, RARITY_TAG } from "./gift-format";

/** Frenz Gift Coin Part 4: the gift sheet's formatting and the admin's gifting form (test-only values). */
describe("gift sheet helpers", () => {
  it("formats FGC minor units exactly", () => {
    expect(fgcText(5000)).toBe("50.00");
    expect(fgcText(1)).toBe("0.01");
    expect(fgcText(123_456_789)).toBe("1,234,567.89");
    expect(fgcText(-450)).toBe("−4.50");
  });
  it("tags Rare and above only", () => {
    expect(RARITY_TAG.common).toBeNull();
    expect(RARITY_TAG.legendary?.label).toBe("Legendary");
  });
  it("lists categories in first-seen order, without blanks or repeats", () => {
    expect(categoriesOf([{ category: "love" }, { category: null }, { category: "fun" }, { category: "love" }])).toEqual(["love", "fun"]);
  });
  it("makes idempotency keys the server accepts (8–80 of A-Z a-z 0-9 _ -), different each time", () => {
    const a = giftKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(giftKey()).not.toBe(a);
  });
  it("words every refusal without leaking anything", () => {
    expect(giftFailureText("insufficient", null)).toMatch(/Convert Frenz Coins/);
    expect(giftFailureText("authorization_failed", "x")).toBe("That PIN wasn't accepted. Nothing was sent.");
    expect(giftFailureText("weird", "Server said so")).toBe("Server said so");
  });
});

describe("the admin's gifting form", () => {
  it("is empty until rules are saved — nothing is a default", () => {
    expect(formFromGifting(null)).toEqual({ sharePercent: "", holdHours: "", cooldownHours: "", dailyMax: "" });
    expect(readGiftingForm(formFromGifting(null), 0).ok).toBe(false);
  });
  it("90% with a 72-hour hold becomes 9000 / 1000 bp, exactly", () => {
    const r = readGiftingForm({ sharePercent: "90", holdHours: "72", cooldownHours: "0", dailyMax: "1000" }, 0);
    expect(r).toMatchObject({ ok: true, fields: { recipientShareBp: 9000, commissionBp: 1000, holdHours: 72, senderCooldownHours: 0, dailyMaxFgc: 100_000 }, rules: { version: 1 } });
  });
  it.each([
    ["more decimals than a percentage has", { sharePercent: "90.005" }, "sharePercent"],
    ["0% to the recipient", { sharePercent: "0" }, "sharePercent"],
    ["over 100%", { sharePercent: "100.01" }, "sharePercent"],
    ["no hold", { holdHours: "0" }, "holdHours"],
    ["a fractional hold", { holdHours: "1.5" }, "holdHours"],
    ["no daily limit", { dailyMax: "0" }, "dailyMax"],
  ])("refuses %s on the right box", (_, patch, box) => {
    const r = readGiftingForm({ sharePercent: "90", holdHours: "72", cooldownHours: "0", dailyMax: "1000", ...patch }, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields)).toEqual([box]);
  });
  it("stored rules round-trip through the form", () => {
    const g = { version: 4, recipientShareBp: 8750, commissionBp: 1250, holdHours: 96, senderCooldownHours: 24, dailyMaxFgc: 250_050 };
    const r = readGiftingForm(formFromGifting(g), 4);
    expect(r).toMatchObject({ ok: true, fields: { recipientShareBp: 8750, commissionBp: 1250, holdHours: 96, senderCooldownHours: 24, dailyMaxFgc: 250_050 } });
  });
});

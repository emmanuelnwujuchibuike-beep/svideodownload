import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GIFT_BATCH_MAX, GIFT_NOTE_MAX, giftTotal, isGiftQuantity, normalizeGiftNote } from "@/lib/gift/batch";

import { giftLine } from "./gift-bubble";
import { askConfirmAgain, coachDismissed, CONFIRM_SKIP_MS, confirmSkipped, dismissCoach, giftReturn, isChatPath, rememberGiftReturn, skipConfirmForAWeek } from "./gift-prefs";

/**
 * Frenz Gift Coin Part 6 — the pieces of the sheet, bubble, reveal and top-up that can be pinned without a browser:
 * the quantity and note rules (the same the server and database apply), the bubble wording, the week-long "don't ask
 * again", the coach mark, the return-to-chat path (a chat path only), and — read from the source — that the reveal
 * writes nothing, the top-up never charges, and every animation has its Reduce Motion form.
 */
const src = (f: string) => readFileSync(f, "utf8");

describe("quantity and note rules", () => {
  it("quantity: whole numbers 1..10 only", () => {
    expect(GIFT_BATCH_MAX).toBe(10);
    for (const ok of [1, 5, 10]) expect(isGiftQuantity(ok)).toBe(true);
    for (const bad of [0, -1, 11, 1.5, Number.NaN, "3", null]) expect(isGiftQuantity(bad)).toBe(false);
  });
  it("note: none, blank, trimmed, 200 code points, too long, control characters", () => {
    expect(normalizeGiftNote(undefined)).toEqual({ ok: true, note: null });
    expect(normalizeGiftNote("")).toEqual({ ok: true, note: null });
    expect(normalizeGiftNote("   ")).toEqual({ ok: true, note: null });
    expect(normalizeGiftNote("  hi  ")).toEqual({ ok: true, note: "hi" });
    expect(normalizeGiftNote("😀".repeat(GIFT_NOTE_MAX))).toEqual({ ok: true, note: "😀".repeat(200) });
    expect(normalizeGiftNote("x".repeat(201))).toEqual({ ok: false, reason: "note_too_long" });
    expect(normalizeGiftNote("a\nb")).toEqual({ ok: false, reason: "note_invalid" });
    expect(normalizeGiftNote(42)).toEqual({ ok: false, reason: "note_invalid" });
    expect(normalizeGiftNote("<b>hi</b> & 'x'")).toEqual({ ok: true, note: "<b>hi</b> & 'x'" });
  });
  it("the total shown is unit price × quantity", () => {
    expect(giftTotal(5000, 3)).toBe(15_000);
  });
});

describe("the bubble's words", () => {
  it("one gift and several, for the sender, the recipient and a group member", () => {
    expect(giftLine({ name: "Rose", quantity: 3 }, true, false, "Ada", "Bo")).toBe("You sent Bo 3 gifts");
    expect(giftLine({ name: "Rose", quantity: 3 }, false, true, "Ada", "Bo")).toBe("Ada sent you 3 gifts");
    expect(giftLine({ name: "Rose", quantity: 3 }, false, false, "Ada", "Bo")).toBe("Ada sent Bo 3 gifts");
    expect(giftLine({ name: "Rose", quantity: 1 }, false, true, "Ada", "Bo")).toBe("Ada sent you a gift");
    expect(giftLine({ name: "Rose" }, false, true, "Ada", "Bo")).toBe("Ada sent you a gift");
  });
});

describe("device conveniences", () => {
  const store = new Map<string, string>();
  const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", { localStorage: fake, sessionStorage: fake });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ask to confirm: by default yes; skipped for exactly a week when chosen; can be turned back on", () => {
    const now = 1_000_000;
    expect(confirmSkipped(now)).toBe(false);
    skipConfirmForAWeek(now);
    expect(confirmSkipped(now + CONFIRM_SKIP_MS - 1)).toBe(true);
    expect(confirmSkipped(now + CONFIRM_SKIP_MS)).toBe(false);
    skipConfirmForAWeek(now);
    askConfirmAgain();
    expect(confirmSkipped(now)).toBe(false);
  });
  it("the coach mark, once dismissed, stays dismissed", () => {
    expect(coachDismissed()).toBe(false);
    dismissCoach();
    expect(coachDismissed()).toBe(true);
  });
  it("only a chat path is remembered for the way back", () => {
    rememberGiftReturn("https://evil.example/x");
    expect(giftReturn()).toBeNull();
    rememberGiftReturn("/messages/00000000-0000-4000-8000-0000000000c1");
    expect(giftReturn()).toBe("/messages/00000000-0000-4000-8000-0000000000c1");
    expect(isChatPath("/wallet")).toBe(false);
  });
  it("blocked storage behaves as never set — nothing throws", () => {
    vi.stubGlobal("window", { get localStorage(): Storage { throw new Error("blocked"); }, get sessionStorage(): Storage { throw new Error("blocked"); } });
    expect(confirmSkipped()).toBe(false);
    expect(() => skipConfirmForAWeek()).not.toThrow();
    expect(coachDismissed()).toBe(false);
  });
});

describe("read from the source", () => {
  it("the reveal writes nothing: no fetch, no POST — reopening it can't touch money, gifts or notifications", () => {
    const reveal = src("features/gift/gift-reveal.tsx");
    expect(reveal).not.toMatch(/fetch\(|method:\s*"POST"|supabase/);
    expect(src("features/gift/gift-bubble.tsx")).not.toMatch(/fetch\(/);
  });
  it("the reveal and the sheet's animations each have a Reduce Motion form", () => {
    for (const f of ["features/gift/gift-reveal.tsx", "features/gift/gift-sheet.tsx", "features/gift/gift-composer-button.tsx"]) {
      const s = src(f);
      expect(s, f).toMatch(/motion-safe:animate-in/);
      expect(s, f).not.toMatch(/(?<!motion-safe:|motion-reduce:)\banimate-(?:bounce|spin|ping|pulse)\b(?![^"]*aria-busy)/);
    }
    expect(src("features/gift/gift-reveal.tsx")).toMatch(/motion-reduce:animate-in motion-reduce:fade-in/);
  });
  it("the top-up only opens the existing deposit and conversion screens — it never charges, deposits or converts", () => {
    const sheet = src("features/gift/gift-sheet.tsx");
    const topUp = sheet.slice(sheet.indexOf("function TopUp("));
    expect(topUp).toContain('href="/wallet/deposit"');
    expect(topUp).toContain("/wallet/gifts?convert=fc_to_fgc");
    expect(topUp).not.toMatch(/fetch\(|\/api\/coin|\/api\/gift\/convert|checkout/);
    // no coin packs, no store checkout: the design's App Store packs do not exist on the web
    expect(topUp).not.toMatch(/App Store|Buy d|Restore purchases/);
  });
  it("the batch send carries no PIN and no client total", () => {
    const sheet = src("features/gift/gift-sheet.tsx");
    const call = sheet.slice(sheet.indexOf('fetch("/api/gift/send"'), sheet.indexOf('fetch("/api/gift/send"') + 600);
    expect(call).not.toMatch(/\bpin\b|total/i);
    expect(call).toContain("quantity");
  });
  it("there is still no Gift Coin withdrawal: the converter points to the ordinary FC withdrawal", () => {
    expect(src("features/gift/gift-box.tsx")).toContain('href="/wallet/withdraw"');
    expect(src("features/gift/gift-sheet.tsx")).not.toMatch(/withdraw/i);
  });
});

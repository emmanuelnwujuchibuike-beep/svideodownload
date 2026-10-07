import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeAiPlansConfig } from "@/lib/ai/credits/config";
import { normalizeTextToAudioConfig, textToAudioAllowance, textToAudioCoverage } from "@/lib/ai/text-to-audio/config";
import { textToAudioPartialOptions } from "@/lib/ai/text-to-audio/pricing";

/**
 * 0185 — Text to Audio's characters per tier and the text that is longer
 * than what is left (credit brief §7–§11; owner 2026-10-07: tiers Free / AI
 * Pro / AI Max, partial = "ask each time").
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the month's characters per tier", () => {
  it("a plan without its own number gets Free's — the 2026-09-21 rule stays the default", () => {
    const c = normalizeTextToAudioConfig({ freeCharactersPerMonth: 500 });
    expect(c.tierCharacters).toEqual({ ai_pro: null, ai_max: null });
    expect(textToAudioAllowance(c, "free")).toBe(500);
    expect(textToAudioAllowance(c, "ai_pro")).toBe(500);
  });
  it("each plan can be set apart", () => {
    const c = normalizeTextToAudioConfig({ freeCharactersPerMonth: 500, tierCharacters: { ai_pro: 20000, ai_max: "100000" } });
    expect([textToAudioAllowance(c, "free"), textToAudioAllowance(c, "ai_pro"), textToAudioAllowance(c, "ai_max")]).toEqual([500, 20000, 100000]);
  });
  it("the default partial rule is ask (owner)", () => {
    expect(normalizeTextToAudioConfig({}).partialAllowance).toBe("ask");
    expect(normalizeTextToAudioConfig({ partialAllowance: "nonsense" }).partialAllowance).toBe("ask");
  });
});

describe("how much of the allowance a text may use", () => {
  it("fits entirely → all of it, no question", () => {
    expect(textToAudioCoverage({ characters: 300, remaining: 500, policy: "ask" })).toEqual({ covered: 300, choiceRequired: false });
  });
  it("none left → 0, no question (the member still presses Use N credits)", () => {
    expect(textToAudioCoverage({ characters: 300, remaining: 0, policy: "ask" })).toEqual({ covered: 0, choiceRequired: false });
  });
  it("🔴 partly, rule ask, no choice → the member must choose; nothing is assumed", () => {
    expect(textToAudioCoverage({ characters: 3500, remaining: 2000, policy: "ask" })).toEqual({ covered: 0, choiceRequired: true });
    expect(textToAudioCoverage({ characters: 3500, remaining: 2000, policy: "ask", choice: "split" })).toEqual({ covered: 2000, choiceRequired: false });
    expect(textToAudioCoverage({ characters: 3500, remaining: 2000, policy: "ask", choice: "all_credits" })).toEqual({ covered: 0, choiceRequired: false });
  });
  it("the operator's fixed rules ignore a member's choice", () => {
    expect(textToAudioCoverage({ characters: 3500, remaining: 2000, policy: "split", choice: "all_credits" })).toEqual({ covered: 2000, choiceRequired: false });
    expect(textToAudioCoverage({ characters: 3500, remaining: 2000, policy: "all_credits", choice: "split" })).toEqual({ covered: 0, choiceRequired: false });
  });
  it("both options are priced by the same engine, and using the allowance is never dearer", () => {
    const tta = normalizeTextToAudioConfig({ models: { elevenlabs: { perCharacterCents: 0.3 } } });
    const plans = normalizeAiPlansConfig({ credits: { centsPerCredit: 10 } });
    const o = textToAudioPartialOptions(3500, 2000, tta, plans, "USD");
    expect(o.split).toMatchObject({ freeCharacters: 2000, billableCharacters: 1500 });
    expect(o.all_credits).toMatchObject({ freeCharacters: 0, billableCharacters: 3500 });
    expect(o.split.credits).toBeLessThan(o.all_credits.credits);
  });
});

describe("🔴 generate: the choice before anything is taken, and no credit spent without the price shown", () => {
  const g = code("lib/ai/text-to-audio/generate.ts");
  it("asks, then refuses a paid generation that carries no shown price, then takes the characters", () => {
    const choice = g.indexOf('refuse("TTA_ALLOWANCE_CHOICE"');
    const unshown = g.indexOf("if (shown.totalCents > 0 && !body.quote) return refuse(\"PRICE_CHANGED\"");
    const take = g.indexOf("consumeFreeCharacters(ownerId, monthKey, coverage.covered, allowance)");
    expect(choice).toBeGreaterThan(-1);
    expect(unshown).toBeGreaterThan(choice);
    expect(take).toBeGreaterThan(unshown);
  });
  it("the allowance is the member's tier's, never the flat Free number", () => {
    expect(g).toContain("textToAudioAllowance(config, fctx.tier)");
    expect(g).not.toContain("const allowance = config.freeCharactersPerMonth;");
    expect(code("app/api/ai/text-to-audio/quote/route.ts")).toContain("textToAudioAllowance(config, fctx.tier)");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Step 16 — the Frenz AI welcome to design/AIStudio.dc.html with the owner's notes (2026-10-19).
 * Pinned to the source, each rule with a case that fails when it's taken out.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const welcome = src("features/ai/frenz-ai-welcome.tsx");
const live = src("features/ai/frenz-ai-welcome-live.tsx");
const parts = src("features/ai/design/ai-welcome-parts.tsx");

function rules(w: string, l: string, p: string) {
  return {
    // the admin's showcase (videos autoplay muted) as the full-bleed hero, with the two glass pills over it
    hero: /<AiShowcase\s+slides=\{slides\}\s+base=\{base\}\s+variant="hero"/.test(w) && w.includes("<AiCreditsPill />") && w.includes("Frenz AI</span>"),
    // the credits card: real balance (the strip's own live snapshot), Earn and View
    creditsCard: w.includes("<AiCreditsCard base={base} />") && p.includes("useAiCreditBalance()") && p.includes('href="/quests"') && p.includes("`${base}/usage`"),
    // the intro and the three chips — no gradient text
    intro: w.includes('Create. Transform. <span className="text-frenz-violet">Perfect.</span>') && ["Fast", "Secure", "Natural results"].every((t) => w.includes(`label: "${t}"`)),
    noGradientText: !/bg-clip-text|text-gradient/.test(w),
    // the big gradient Create with AI (opens the AI Studio) and the round History button
    dock: /href=\{exploreHref\}[\s\S]{0,200}bg-frenz-gradient-x[\s\S]{0,400}Create with AI/.test(l) && /href=\{historyHref\}[\s\S]{0,300}rounded-full/.test(l),
    studioDoor: w.includes("exploreHref={`${base}/character-replace`}"),
  };
}

describe("the Frenz AI welcome (step 16)", () => {
  it("keeps every rule of the design and the owner's notes", () => {
    expect(rules(welcome, live, parts)).toEqual({ hero: true, creditsCard: true, intro: true, noGradientText: true, dock: true, studioDoor: true });
  });

  it("teeth: each rule fails when it's taken out", () => {
    expect(rules(welcome.replace('variant="hero"', ""), live, parts).hero).toBe(false);
    expect(rules(welcome, live, parts.replaceAll("useAiCreditBalance()", "null")).creditsCard).toBe(false);
    expect(rules(welcome.replace('label: "Secure"', 'label: "Safe"'), live, parts).intro).toBe(false);
    expect(rules(welcome + ' className="bg-clip-text"', live, parts).noGradientText).toBe(false);
    expect(rules(welcome, live.replace("bg-frenz-gradient-x", "bg-frenz-fill"), parts).dock).toBe(false);
  });

  it("over the video, glass rides the shared AI tiers (solid when transparency is reduced)", () => {
    const showcase = src("features/ai/design/ai-showcase.tsx");
    expect(showcase).toContain("ai-glass ai-glass--media");
    expect(src("app/globals.css")).toMatch(/\.ai-glass--media \{ --ai-glass-rgb: 14 12 30;/);
  });
});
